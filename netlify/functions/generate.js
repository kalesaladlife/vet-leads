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

  const { titleVal, size, state, service, specialty, college, numProspects, existing } = parsed;

  if (!titleVal || !service) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const count = 2;

  try {
    const apolloPayload = {
      per_page: count * 3,
      person_titles: [titleVal],
      q_keywords: specialty && specialty !== 'any' ? `veterinary ${specialty}` : 'veterinary',
      contact_email_status: ['verified', 'guessed', 'unavailable'],
    };

    if (state && state !== 'any') {
      apolloPayload.person_locations = [`${state}, United States`];
    }

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

    const validPeople = people.filter(p =>
      p.name && p.name !== 'Unknown' &&
      p.organization && p.organization.name &&
      p.organization.name !== 'Veterinary Site'
    ).slice(0, count);

    if (validPeople.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ prospects: [], message: 'No complete results found — try broader criteria' }) };
    }

    const peopleList = validPeople.map(p => ({
      name: p.name || 'Unknown',
      title: p.title || titleVal,
      company: p.organization ? p.organization.name : 'Unknown Practice',
      location: p.city && p.state ? `${p.city}, ${p.state}` : (state || 'Unknown'),
      employees: p.organization ? p.organization.estimated_num_employees : null,
      linkedin: p.linkedin_url || '',
      email: p.email || null,
    }));

    const enrichPrompt = `You are a B2B sales expert. For each of these real veterinary prospects, generate a fit score and personalized outreach content for selling: ${service}.

Prospects:
${JSON.stringify(peopleList, null, 2)}

For each prospect respond with a JSON array where each object has:
- contact_name (from input name)
- title (from input title)
- company (from input company)
- industry (guess their veterinary specialty based on their name or company)
- company_size (use employee count if available, otherwise estimate as a range like "5-10 employees")
- state (extract from location field)
- vet_college (leave as "Unknown")
- linkedin_hint (from input linkedin field, keep as-is)
- email_guess (from input email if available, otherwise guess as firstname.lastname@companydomain.com)
- fit_score (one of exactly: "Strong fit", "Good fit", "Possible fit")
- outreach_angle (1 personalized sentence about why this service fits them specifically)
- email_subject (short personalized subject line for a cold outreach email)
- email_body (3-4 sentence personalized cold email written as a single paragraph with no line breaks or special characters)

Respond ONLY with a valid JSON array. No markdown, no backticks, no explanation.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: enrichPrompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const text = claudeData.content.map(b => b.text || '').join('');
    const cleaned = text.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
    const match = cleaned.match(/\[.*\]/s);
    if (!match) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not parse enrichment response', raw: text.slice(0, 200) }) };
    }

    const prospects = JSON.parse(match[0]);
    return { statusCode: 200, body: JSON.stringify({ prospects }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
