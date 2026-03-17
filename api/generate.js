export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { titleVal, size, state, service, existing } = req.body;

  if (!titleVal || !service) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const prompt = `You are a B2B lead generation expert specializing in the veterinary industry. Generate exactly 4 realistic fictional prospect leads for a professional services company targeting veterinary practices.

Service being sold: ${service}
Industry: Veterinary (always — small animal clinics, large animal practices, emergency vet hospitals, specialist referral centers, mixed practices, corporate vet groups, etc.)
Decision maker title: ${titleVal}
Practice size preference: ${size || 'any'}
State: ${state && state !== 'any' ? state : 'any US state'}
${existing && existing.length ? `Already generated practices: ${existing.join(', ')} — generate 4 different ones.` : ''}

Distribute fit scores realistically: mix of Strong fit, Good fit, and Possible fit across the 4 prospects.
Use the "industry" field for the veterinary specialty/practice type (e.g. "Small animal clinic", "Emergency & critical care", "Equine practice", "Corporate vet group").
Use the "state" field for the US state the practice is located in${state && state !== 'any' ? ` — all prospects must be in ${state}` : ''}.

Respond ONLY with a valid JSON array (no markdown, no preamble) of 4 objects with these exact keys:
contact_name, title, company, industry, company_size, state, linkedin_hint, email_guess, fit_score (one of: "Strong fit", "Good fit", "Possible fit"), outreach_angle (1 sentence personalized reason)`;

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
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const prospects = JSON.parse(clean);

    return res.status(200).json({ prospects });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
