import { AIError, ERROR_KINDS, fetchFailure, kindFromStatus, parseRetryAfter, readBody, shortMessage } from '../ai/errors.js';
import { formatTimestamp } from '../transcript.js';

/** ISO-639-1 codes for the language names people usually type. */
const LANG_CODES = { english: 'en', arabic: 'ar', french: 'fr', german: 'de', spanish: 'es', italian: 'it', portuguese: 'pt', dutch: 'nl', turkish: 'tr', russian: 'ru', hindi: 'hi', urdu: 'ur', chinese: 'zh', japanese: 'ja', korean: 'ko', polish: 'pl', swedish: 'sv', persian: 'fa', hebrew: 'he' };
export const languageCode = (lang = '') => {
  const l = String(lang).trim().toLowerCase();
  if (/^[a-z]{2}$/.test(l)) return l;
  return LANG_CODES[l] || '';
};

/**
 * OpenAI-compatible speech-to-text (Groq Whisper, OpenAI). Groq's free tier runs
 * whisper-large-v3(-turbo) very fast and is the audio fallback when Gemini is busy.
 * Segments become "[mm:ss] text" lines so timestamps survive.
 */
export function createWhisperProvider({ name = 'groq', apiKey, baseURL = 'https://api.groq.com/openai/v1', maxBytes = 25 * 1024 * 1024, fetchImpl = fetch } = {}) {
  return {
    name,
    configured: Boolean(apiKey),
    kind: 'audio',
    async complete({ model, audio, language, vocabulary, signal, timeoutMs = 180_000 }) {
      if (!apiKey) throw new AIError(`${name} API key is not set`, { kind: ERROR_KINDS.auth, provider: name, model });
      if (!audio?.buffer) throw new AIError('no audio given', { kind: ERROR_KINDS.bad_request, provider: name, model });
      if (audio.buffer.length > maxBytes) {
        throw new AIError(`${name}: file is ${(audio.buffer.length / 1048576).toFixed(1)} MB, over the ${Math.round(maxBytes / 1048576)} MB limit`, { kind: ERROR_KINDS.bad_request, provider: name, model });
      }
      const verbose = /whisper/i.test(model);
      const form = new FormData();
      // Whisper decides the format from the file name; Telegram ".oga" is plain Ogg/Opus.
      const fileName = String(audio.name || 'voice-note.ogg').replace(/\.oga$/i, '.ogg');
      form.append('file', new Blob([audio.buffer], { type: audio.mime }), fileName);
      form.append('model', model);
      form.append('response_format', verbose ? 'verbose_json' : 'json');
      form.append('temperature', '0');
      const code = languageCode(language);
      if (code) form.append('language', code);
      if (vocabulary) form.append('prompt', `Names and terms: ${vocabulary}`.slice(0, 800));

      const timeout = AbortSignal.timeout(timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${baseURL}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch (err) {
        throw fetchFailure(err, { provider: name, model, callerSignal: signal });
      }
      const payload = await readBody(res).catch((err) => {
        throw fetchFailure(err, { provider: name, model, callerSignal: signal });
      });
      if (!res.ok) {
        throw new AIError(`${name} ${res.status}: ${shortMessage(payload.json, payload.text)}`, {
          kind: kindFromStatus(res.status, payload.text),
          status: res.status,
          retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after'), payload.json),
          provider: name,
          model,
        });
      }
      const data = payload.json;
      const segments = Array.isArray(data.segments) ? data.segments : [];
      const text = segments.length ? segmentsToLines(segments) : String(data.text || '').trim();
      if (!text) throw new AIError(`${name} returned an empty transcript`, { kind: ERROR_KINDS.bad_output, provider: name, model });
      return { text, truncated: false, durationSeconds: data.duration ? Math.round(data.duration) : null, detectedLanguage: data.language || '' };
    },
  };
}

/** Join Whisper's short segments into sentence-sized lines that keep their start time. */
export function segmentsToLines(segments) {
  const lines = [];
  let cur = null;
  for (const s of segments) {
    const t = String(s.text || '').trim();
    if (!t) continue;
    if (!cur) cur = { start: Number(s.start) || 0, text: t };
    else cur.text += ` ${t}`;
    if (/[.!?…]["')\]]?$/.test(t) || cur.text.length > 280) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => `[${formatTimestamp(l.start)}] ${l.text}`).join('\n');
}
