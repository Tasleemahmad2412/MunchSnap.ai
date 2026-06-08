import { callGeminiApi } from '../lib/gemini.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server API key not configured. Set GEMINI_API_KEY in Vercel environment variables.',
    });
  }

  const { base64Image, prompt } = req.body || {};
  if (!base64Image || !prompt) {
    return res.status(400).json({ error: 'Missing base64Image or prompt' });
  }

  try {
    const text = await callGeminiApi(apiKey, base64Image, prompt);
    return res.status(200).json({ text });
  } catch (err) {
    const message = err.message || 'Failed to reach Gemini API';
    const lower = message.toLowerCase();
    const isQuota = lower.includes('quota') || message.includes('limit: 0');
    const isTraffic = lower.includes('high traffic') || lower.includes('overloaded') || lower.includes('unavailable');
    const status = isQuota || isTraffic ? 429 : 502;
    return res.status(status).json({ error: message });
  }
}
