// Lightest models first — less likely to hit "high traffic" overload
export const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

const MAX_RETRIES_PER_MODEL = 2;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldTryNextModel(status, errorMessage = '') {
  if ([404, 429, 500, 502, 503].includes(status)) return true;
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('limit: 0') ||
    msg.includes('quota') ||
    msg.includes('not found') ||
    msg.includes('high traffic') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('try again') ||
    msg.includes('capacity')
  );
}

export function parseRetrySeconds(errorMessage = '') {
  const match = errorMessage.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1])) : 0;
}

export function getRetryDelayMs(errorMessage, attempt) {
  const fromApi = parseRetrySeconds(errorMessage);
  if (fromApi > 0) return fromApi * 1000;
  return Math.min(2000 * 2 ** attempt, 12000) + Math.random() * 800;
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

async function requestModel(apiKey, model, base64Image, prompt) {
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

  return { response, data, errorMessage };
}

export async function callGeminiApi(apiKey, base64Image, prompt) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      const { response, data, errorMessage } = await requestModel(apiKey, model, base64Image, prompt);

      if (!response.ok) {
        lastError = errorMessage;
        if (shouldTryNextModel(response.status, errorMessage)) {
          if (attempt < MAX_RETRIES_PER_MODEL) {
            await sleep(getRetryDelayMs(errorMessage, attempt));
            continue;
          }
          break;
        }
        throw new Error(errorMessage);
      }

      const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textOutput) {
        lastError = 'No response from Gemini API';
        break;
      }

      return textOutput;
    }
  }

  throw new Error(
    lastError ||
    'All Gemini models are busy. Wait a minute and try again, or use a new API key from https://aistudio.google.com/apikey'
  );
}
