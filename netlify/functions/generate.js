exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad JSON: ' + e.message }) };
  }

  const { titleVal, size, state, city, service, specialty, seniority, revenue, numProspects, seenIds } = parsed;

  if (!titleVal || !service) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const count = Math.min(numProspects || 4, 10);
  const seen = seenIds || [];

  try {
    const apolloPayload = {
      per_page: 25,
      person_titles: [titleVal],
      organization_keywords: ['veterinary', 'animal hospital', 'animal clinic', 'vet clinic'],
    };

    // Location filter — city takes priority over state
    if (city) {
      apolloPayload.person_locations = state && state !== 'any'
        ? [`${city}, ${state}, United States`]
        : [`${city}, United States`];
    } else if (state && state !== 'any') {
      apolloPayload.person_locations = [`${state}, United States`];
    } else {
      apolloPayload.person_locations = ['United States'];
    }

    // Seniority filter
    if (seniority && seniority !== 'any') {
      apolloPayload.person_seniorities = [seniority];
    }

    // Employee size filter
    if (size && size !== 'any') {
      const sizeMap = {
        '1-10': [1, 10], '11-50': [11, 50], '51-200': [51, 200],
        '201-500': [201, 500], '500+': [500, 100000],
      };
      if (sizeMap[size]) {
        apolloPayload.organization_num_employees_ranges = [`${sizeMap[size][0]},${sizeMap[size][1]}`];
      }
    }

    // Revenue filter
    if (revenue && revenue !== 'any') {
      const [min, max] = revenue.split(',');
      apolloPayload.revenue_range = { min: parseInt(min), max: parseInt(max) };
    }

    const apolloRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(apolloPayload),
    });

    if (!apolloRes.ok) {
      const errText = await apolloRes.text();
      return { statusCode: apolloRes.status, body: JSON.stringify({ error: 'Apollo error: ' + errText.slice(0, 200) }) };
    }

    const apolloData = await apolloRes.json();
    const people = apolloData.people || [];

    // Filter out already seen people
    const freshPeople = people.filter(p => !seen.includes(p.id));

    if (freshPeople.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ prospects: [], message: 'No new results found — try different criteria' }) };
    }

    // Reveal full details via bulk match
    const candidates = freshPeople.slice(0, count);
    const ids = candidates.map(p => p.id);

    const enrichRes = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify({
        details: ids.map(id => ({ id })),
        reveal_personal_emails: false,
      }),
    });

    let enrichedPeople = candidates;
    if (enrichRes.ok) {
      const enrichData = await enrichRes.json();
      if (enrichData.matches && enrichData.matches.length > 0) {
        enrichedPeople = enrichData.matches;
      }
    }

    const prospects = enrichedPeople
      .filter(p => p.first_name && p.organization && p.organization.name)
      .map(p => {
        const lastName = p.last_name || '';
        const domain = p.organization.website_url
          ? p.organization.website_url.replace(/https?:\/\//, '').replace(/\/$/, '').split('/')[0]
          : 'unknown.com';
        const email = p.email ||
          (lastName
            ? `${p.first_name.toLowerCase()}.${lastName.toLowerCase()}@${domain}`
            : `${p.first_name.toLowerCase()}@${domain}`);

        const revenueVal = p.organization.annual_revenue
          ? `$${(p.organization.annual_revenue / 1000000).toFixed(1)}M`
          : '—';

        return {
          apollo_id: p.id,
          contact_name: `${p.first_name} ${lastName}`.trim(),
          title: p.title || titleVal,
          company: p.organization.name,
          industry: 'Veterinary',
          company_size: p.organization.estimated_num_employees
            ? `${p.organization.estimated_num_employees} employees`
            : 'Unknown',
          city: p.city || city || '',
          state: p.state || state || 'Unknown',
          revenue: revenueVal,
          linkedin_hint: p.linkedin_url || '',
          email_guess: email,
          fit_score: 'Good fit',
          outreach_angle: `${p.first_name} at ${p.organization.name} may benefit from ${service}.`,
          email_subject: `${service} for ${p.organization.name}`,
          email_body: `Hi ${p.first_name}, I wanted to reach out about ${service} for ${p.organization.name}. I'd love to schedule a quick call to learn more about your needs. Would you have 15 minutes this week?`,
        };
      });

    return { statusCode: 200, body: JSON.stringify({ prospects }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
