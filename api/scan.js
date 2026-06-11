
// Simple in-memory rate limiter (per serverless instance)
const rateLimitMap = new Map();
 
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 10; // max 10 scans per minute per IP
 
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
 
  const entry = rateLimitMap.get(ip);
 
  // Reset window if expired
  if (now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
 
  // Increment and check
  entry.count++;
  if (entry.count > maxRequests) {
    return true; // rate limited
  }
 
  return false;
}
 
// Clean up old entries every 100 requests to prevent memory bloat
let cleanupCounter = 0;
function cleanupRateLimit() {
  cleanupCounter++;
  if (cleanupCounter % 100 === 0) {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now - entry.start > 60 * 1000) {
        rateLimitMap.delete(ip);
      }
    }
  }
}
 
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  // Get client IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
 
  // Rate limit check
  cleanupRateLimit();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment before scanning again.' });
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
 
    // Payload size check — reject if image is over 10MB base64
    if (imageBase64.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large. Please use a smaller photo.' });
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
 
