import { buildSystemPrompt } from './modes';

async function uriToBase64(uri) {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result;
      const comma = typeof s === 'string' ? s.indexOf(',') : -1;
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(new Error('Failed to read audio file.'));
    reader.readAsDataURL(blob);
  });
}

const MODEL = 'google/gemini-3.1-flash-lite-preview';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export async function transcribeAndTransform({ audioUri, audioUris, mode, userName, recipient, apiKey }) {
  if (!apiKey) throw new Error('No OpenRouter API key set. Add one in Settings.');
  const uris = Array.isArray(audioUris) ? audioUris : (audioUri ? [audioUri] : []);
  if (!uris.length) throw new Error('No audio recorded.');

  const audioParts = [];
  for (const uri of uris) {
    const b64 = await uriToBase64(uri);
    audioParts.push({ type: 'input_audio', input_audio: { data: b64, format: 'm4a' } });
  }
  const systemPrompt = buildSystemPrompt(mode, { userName, recipient });
  const userText = uris.length > 1
    ? `Transcribe the ${uris.length} audio clips below as ONE continuous message (they are sequential recordings of the same message), then apply the transformation described in the system prompt.`
    : 'Transcribe the audio and apply the transformation described in the system prompt.';

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text', text: userText }, ...audioParts] },
    ],
    temperature: 0.3,
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/danielrosehill/Voxcast',
      'X-Title': 'Voxcast',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from model.');
  return typeof text === 'string' ? text : text.map(p => p.text || '').join('').trim();
}
