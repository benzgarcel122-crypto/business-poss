
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }
 
  try {
    const { imageBase64, mimeType } = req.body;
 
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image data provided' });
    }
 
    const prompt = `You are a stock inventory assistant. Extract all stock items from this receipt or stock list image. For each item return: name (string), qty (number), unit (string like pc/ream/box/bottle/sack/kg/g/L/ml), cost (total price paid for that line item as a number, 0 if not visible). Return ONLY a valid JSON array, no extra text: [{"name":"item name","qty":1,"unit":"pc","cost":0}]`;
 
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
              { text: prompt }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 1500 }
        })
      }
    );
 
    const data = await response.json();
 
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }
 
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
 
    return res.status(200).json({ items: parsed });
 
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process image: ' + err.message });
  }
}
