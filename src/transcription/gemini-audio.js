import { AIError, ERROR_KINDS, fetchFailure, kindFromStatus, parseRetryAfter, readBody, shortMessage } from '../ai/errors.js';

const API = 'https://generativelanguage.googleapis.com';

/**
 * Gemini as an audio transcriber, shaped like a router provider so several Gemini
 * versions can be chained with cooldowns. Small files go inline (base64); large ones
 * are uploaded once to the Files API and the same upload is reused by every Gemini
 * model in the chain. Call cleanup() afterwards to delete uploads.
 */
export function createGeminiAudioProvider({ apiKey, inlineMaxBytes = 14 * 1024 * 1024, fetchImpl = fetch, pollMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const name = 'gemini';
  const uploads = new Map(); // sha256 -> Promise<{ name, uri, mimeType }>

  async function call(url, init, { model, signal, timeoutMs, raw = false }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { ...init, headers: { 'x-goog-api-key': apiKey, ...init.headers }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (err) {
      throw fetchFailure(err, { provider: name, model, callerSignal: signal });
    }
    if (raw && res.ok) return res;
    let payload;
    try {
      payload = await readBody(res);
    } catch (err) {
      throw fetchFailure(err, { provider: name, model, callerSignal: signal });
    }
    if (!res.ok) {
      throw new AIError(`gemini ${res.status}: ${shortMessage(payload.json, payload.text)}`, {
        kind: kindFromStatus(res.status, payload.text),
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after'), payload.json),
        provider: name,
        model,
      });
    }
    return payload.json;
  }

  async function upload(audio, ctx) {
    const start = await call(
      `${API}/upload/v1beta/files`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(audio.buffer.length),
          'X-Goog-Upload-Header-Content-Type': audio.mime,
        },
        body: JSON.stringify({ file: { display_name: String(audio.name || 'voice-note').slice(0, 120) } }),
      },
      { ...ctx, raw: true },
    );
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new AIError('Gemini Files API returned no upload URL', { kind: ERROR_KINDS.overloaded, provider: name });
    const done = await call(uploadUrl, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: audio.buffer }, ctx);
    let file = done.file;
    if (!file?.name) throw new AIError('Gemini Files API upload returned no file', { kind: ERROR_KINDS.overloaded, provider: name });
    const deadline = Date.now() + ctx.timeoutMs;
    while (file.state === 'PROCESSING') {
      if (Date.now() > deadline) throw new AIError('Gemini file processing timed out', { kind: ERROR_KINDS.timeout, provider: name });
      await sleep(pollMs);
      file = await call(`${API}/v1beta/${file.name}`, { method: 'GET' }, ctx);
    }
    if (file.state === 'FAILED') throw new AIError(`Gemini could not process ${audio.name}`, { kind: ERROR_KINDS.bad_request, provider: name });
    return { name: file.name, uri: file.uri, mimeType: file.mimeType || audio.mime };
  }

  return {
    name,
    configured: Boolean(apiKey),
    kind: 'audio',
    async complete({ model, messages, audio, temperature = 0, maxTokens = 65536, signal, timeoutMs = 180_000 }) {
      if (!apiKey) throw new AIError('GEMINI_API_KEY is not set', { kind: ERROR_KINDS.auth, provider: name, model });
      if (!audio?.buffer) throw new AIError('no audio given', { kind: ERROR_KINDS.bad_request, provider: name, model });
      const ctx = { model, signal, timeoutMs };
      let part;
      if (audio.buffer.length <= inlineMaxBytes) {
        part = { inline_data: { mime_type: audio.mime, data: audio.buffer.toString('base64') } };
      } else {
        const key = audio.sha256 || `${audio.name}:${audio.buffer.length}`;
        if (!uploads.has(key)) {
          const p = upload(audio, ctx);
          uploads.set(key, p);
          p.catch(() => uploads.delete(key)); // a failed upload can be retried by the next model
        }
        const f = await uploads.get(key);
        part = { file_data: { mime_type: f.mimeType, file_uri: f.uri } };
      }
      const prompt = messages.map((m) => m.content).join('\n\n');
      const json = await call(
        `${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, part] }], generationConfig: { temperature, maxOutputTokens: maxTokens } }),
        },
        ctx,
      );
      const candidate = json.candidates?.[0];
      const text = (candidate?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (!text) {
        const why = candidate?.finishReason || json.promptFeedback?.blockReason || 'empty response';
        throw new AIError(`gemini returned no transcript (${why})`, { kind: ERROR_KINDS.bad_output, provider: name, model });
      }
      const u = json.usageMetadata || {};
      return { text, truncated: candidate?.finishReason === 'MAX_TOKENS', usage: { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount } };
    },
    /** Delete Files API uploads (Gemini also removes them after 48 h). */
    async cleanup() {
      const all = [...uploads.values()];
      uploads.clear();
      for (const p of all) {
        try {
          const f = await p;
          await call(`${API}/v1beta/${f.name}`, { method: 'DELETE' }, { model: '', timeoutMs: 15_000 });
        } catch {
          /* best effort */
        }
      }
    },
  };
}
