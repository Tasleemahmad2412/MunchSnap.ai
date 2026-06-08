// Models with free-tier vision support (avoid gemini-2.0-flash — limit: 0 on many accounts)
export const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
];

export function shouldTryNextModel(status, errorMessage = '') {
  if (status === 404 || status === 429) return true;
  const msg = errorMessage.toLowerCase();
  return msg.includes('limit: 0') || msg.includes('quota') || msg.includes('not found');
}

export function parseRetrySeconds(errorMessage = '') {
  const match = errorMessage.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1])) : 0;
}

export function buildGeminiRequestBody(base64Image, prompt) {
  return {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        { text: prompt },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json' },
  };
}

export async function callGeminiApi(apiKey, base64Image, prompt) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiRequestBody(base64Image, prompt)),
      }
    );

    const data = await response.json().catch(() => ({}));
    const errorMessage = data?.error?.message || `HTTP ${response.status}`;

    if (!response.ok) {
      lastError = errorMessage;
      if (shouldTryNextModel(response.status, errorMessage)) continue;
      throw new Error(errorMessage);
    }

    const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOutput) {
      lastError = 'No response from Gemini API';
      continue;
    }

    return textOutput;
  }

  throw new Error(lastError || 'All Gemini models failed. Check your API key and quota at https://aistudio.google.com/apikey');
}
