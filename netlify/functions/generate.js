exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { titleVal, size, state, service, specialty, college, numProspects, existing } = JSON.parse(event.body);

  if (!titleVal || !service) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const count = numProspects || 4;

  const prompt = `You are a B2B lead generation expert specializing in the veterinary industry. Generate exactly ${count} realistic fictional prospect leads for a professional services company targeting veterinary practices.

Service being sold: ${service}
Industry: Veterinary
Decision maker title: ${titleVal}
Practice size preference: ${size || 'any'}
State: ${state && state !== 'any' ? state : 'any US state'}
Veterinary specialty: ${specialty && specialty !== 'any' ? specialty : 'any specialty'}
Vet college attended: ${college && college !== 'any' ? college : 'any veterinary college'}
${existing && existing.length ? `Already generated practices: ${existing.join(', ')} — generate ${count} different ones.` : ''}

Distribute fit scores realistically across the prospects.
Use the "industry" field for the veterinary specialty/practice type.
Use the "state" field for the US state${state && state !== 'any' ? ` — all prospects must be in ${state}` : ''}.
Use the "vet_college" field for the vet school the contact attended${college && college !== 'any' ? ` — all prospects must have attended ${college}` : ''}.
The "linkedin_hint" must be a full URL like "https://linkedin.com/in/firstname-lastname".

Respond ONLY with a valid JSON array (no markdown, no preamble) of ${count} objects with these exact keys:
contact_name, title, company, industry, company_size, state, vet_college, linkedin_hint, email_guess, fit_score (one of: "Strong fit", "Good fit", "Possible fit"), outreach_angle (1 sentence personalized reason)`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const prospects = JSON.parse(clean);

    return { statusCode: 200, body: JSON.stringify({ prospects }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
