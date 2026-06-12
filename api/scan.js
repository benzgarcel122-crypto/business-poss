
export const config = { runtime: 'edge' };
 
// Simple rate limiting using a Map (per edge instance)
const rateLimitMap = new Map();
 
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;
 
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
 
  const entry = rateLimitMap.get(ip);
  if (now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
 
  entry.count++;
  return entry.count > maxRequests;
}
 
export default async function handler(req) {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }
 
  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please wait a moment.' }), {
      status: 429, headers: { 'Content-Type': 'application/json' }
    });
  }
 
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured on server' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
 
  try {
    const { imageBase64, mimeType } = await req.json();
 
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No image data provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
 
    // Payload size check — reject if over 10MB
    if (imageBase64.length > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image too large. Please use a smaller photo.' }), {
        status: 413, headers: { 'Content-Type': 'application/json' }
      });
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
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
 
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
 
    return new Response(JSON.stringify({ items: parsed }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
 
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to process image: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
 
