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

  const { titleVal, size, state, service, specialty, numProspects } = parsed;

  if (!titleVal || !service) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const count = Math.min(numProspects || 4, 10);

  try {
    const apolloPayload = {
      per_page: 25,
      person_titles: [titleVal],
      person_locations: state && state !== 'any' ? [`${state}, United States`] : ['United States'],
      organization_keywords: ['veterinary', 'animal hospital', 'animal clinic', 'vet clinic'],
      contact_email_status: ['verified', 'guessed'],
    };

    if (size && size !== 'any') {
      const sizeMap = {
        '1-10': [1, 10], '11-50': [11, 50], '51-200': [51, 200],
        '201-500': [201, 500], '500+': [500, 100000],
      };
      if (sizeMap[size]) {
        apolloPayload.organization_num_employees_ranges = [`${sizeMap[size][0]},${sizeMap[size][1]}`];
      }
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

    if (people.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ prospects: [], message: 'No results found — try broader criteria' }) };
    }

    // Use bulk enrich endpoint to reveal full contact details
    const ids = people.slice(0, count).map(p => p.id);
    
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

    let enrichedPeople = people.slice(0, count);
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

        return {
          contact_name: `${p.first_name} ${lastName}`.trim(),
          title: p.title || titleVal,
          company: p.organization.name,
          industry: 'Veterinary',
          company_size: p.organization.estimated_num_employees
            ? `${p.organization.estimated_num_employees} employees`
            : 'Unknown',
          state: p.state || state || 'Unknown',
          vet_college: 'Unknown',
          linkedin_hint: p.linkedin_url || '',
          email_guess: email,
          fit_score: 'Good fit',
          outreach_angle: `${p.first_name} at ${p.organization.name} may benefit from ${service}.`,
          email_subject: `${service} for ${p.organization.name}`,
          email_body: `Hi ${p.first_name}, I wanted to reach out about ${service} for ${p.organization.name}. I'd love to schedule a quick call to learn more about your needs. Would you have 15 minutes this week?`,
        };
      });

    if (prospects.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ prospects: [], message: 'No complete results — try broader criteria' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ prospects }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
