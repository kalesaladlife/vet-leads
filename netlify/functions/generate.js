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

  const { titleVal, size, state, service, specialty } = parsed;

  try {
    const apolloPayload = {
      per_page: 5,
      person_titles: [titleVal],
      q_keywords: 'veterinary',
    };

    const apolloRes = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(apolloPayload),
    });

    const apolloData = await apolloRes.json();

    // Return raw Apollo response so we can see what's coming back
    return { statusCode: 200, body: JSON.stringify({ 
      total: apolloData.pagination ? apolloData.pagination.total_entries : 0,
      count: apolloData.people ? apolloData.people.length : 0,
      first_person: apolloData.people && apolloData.people[0] ? {
        name: apolloData.people[0].name,
        title: apolloData.people[0].title,
        org: apolloData.people[0].organization ? apolloData.people[0].organization.name : null,
        state: apolloData.people[0].state,
      } : null,
      error: apolloData.error || null,
    })};

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
