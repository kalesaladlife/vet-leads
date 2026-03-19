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
    };

    if (size && size !== 'any') {
      const sizeMap = {
        '1-10': [1, 10],
        '11-50': [11, 50],
        '51-200': [51, 200],
        '201-500': [201, 500],
        '500+': [500, 100000],
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

    // Return debug info so we can see what's coming back
    if (people.length === 0) {
      return { statusCode: 200, body: JSON.stringify({
        prospects: [],
        message: 'No results found',
        debug: {
          total: apolloData.pagination ? apolloData.pagination.total_entries : 0,
          returned: people.length,
          payload_sent: apolloPayload,
          apollo_error: apolloData.error || null,
        }
      })};
    }

    const validPeople = people.filter(p =>
      p.name &&
      p.first_name &&
      p.last_name &&
      p.organization &&
      p.organization.name
    ).slice(0, count);

    if (validPeople.length === 0) {
      return { statusCode: 200, body: JSON.stringify({
        prospects: [],
        message: 'Results found but missing required fields',
        debug: { total: apolloData.pagination ? apolloData.pagination.total_entries : 0, returned: people.length, sample: people[0] }
      })};
    }

    const prospects = validPeople.map(p => ({
      contact_name: p.name,
      title: p.title || titleVal,
      company: p.organization.name,
      industry: 'Veterinary',
      company_size: p.organization.estimated_num_employees
        ? `${p.organization.estimated_num_employees} employees`
        : 'Unknown',
      state: p.state || state || 'Unknown',
      vet_college: 'Unknown',
      linkedin_hint: p.linkedin_url || '',
      email_guess: p.email || `${p.first_name.toLowerCase()}.${p.last_name.toLowerCase()}@${p.organization.website_url ? p.organization.website_url.replace(/https?:\/\//, '').replace(/\/$/, '') : 'unknown.com'}`,
      fit_score: 'Good fit',
      outreach_angle: `${p.first_name} at ${p.organization.name} may benefit from ${service}.`,
      email_subject: `${service} for ${p.organization.name}`,
      email_body: `Hi ${p.first_name}, I wanted to reach out about ${service} for ${p.organization.name}. I'd love to schedule a quick call to learn more about your needs. Would you have 15 minutes this week?`,
    }));

    return { statusCode: 200, body: JSON.stringify({ prospects }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
