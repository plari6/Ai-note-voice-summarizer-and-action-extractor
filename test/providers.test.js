import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLLMRouter } from '../src/ai/index.js';
import { createAnalyzer, parseAnalysisJson } from '../src/analyzer.js';
import { DEMO_ANALYSIS } from '../src/demo.js';
import { createTranscriber } from '../src/transcriber.js';
import { createGeminiAudioProvider } from '../src/transcription/gemini-audio.js';
import { createWhisperProvider, languageCode } from '../src/transcription/whisper.js';
import { fakeFetch, geminiText } from './helpers.js';

const audio = (bytes = 100) => ({ buffer: Buffer.alloc(bytes, 1), mime: 'audio/ogg', name: 'note.ogg', sha256: 'abc' });

test('Gemini audio: small file goes inline with the prompt', async () => {
  const f = fakeFetch([{ match: (u) => u.includes(':generateContent'), reply: geminiText('[00:01] Hello there') }]);
  const p = createGeminiAudioProvider({ apiKey: 'k', fetchImpl: f.impl });
  const out = await p.complete({ model: 'gemini-3.6-flash', messages: [{ role: 'user', content: 'Transcribe' }], audio: audio() });
  assert.equal(out.text, '[00:01] Hello there');
  const body = JSON.parse(f.calls[0].body);
  assert.equal(body.contents[0].parts[0].text, 'Transcribe');
  assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'audio/ogg');
  assert.equal(f.calls[0].headers['x-goog-api-key'], 'k');
  assert.match(f.calls[0].url, /models\/gemini-3\.6-flash:generateContent/);
});

test('Gemini audio: large file uses the Files API once for every model, then deletes it', async () => {
  const f = fakeFetch([
    { match: (u, i) => u.endsWith('/upload/v1beta/files') && i.method === 'POST', reply: { headers: { 'x-goog-upload-url': 'https://upload.example/xyz' } } },
    { match: (u) => u === 'https://upload.example/xyz', reply: { json: { file: { name: 'files/f1', uri: 'https://gen/files/f1', mimeType: 'audio/ogg', state: 'PROCESSING' } } } },
    { match: (u, i) => u.endsWith('/v1beta/files/f1') && i.method === 'GET', reply: { json: { name: 'files/f1', uri: 'https://gen/files/f1', state: 'ACTIVE' } } },
    { match: (u, i) => u.endsWith('/v1beta/files/f1') && i.method === 'DELETE', reply: { json: {} } },
    { match: (u) => u.includes('gemini-a:generateContent'), reply: { status: 503, json: { error: { message: 'overloaded' } } } },
    { match: (u) => u.includes('gemini-b:generateContent'), reply: geminiText('[00:00] Long note') },
  ]);
  const provider = createGeminiAudioProvider({ apiKey: 'k', inlineMaxBytes: 10, fetchImpl: f.impl, sleep: async () => {}, pollMs: 0 });
  const t = createTranscriber({ providers: { gemini: provider }, config: { audio: { chain: 'gemini:gemini-a,gemini:gemini-b', timeoutMs: 5000, totalBudgetMs: 10000 } } });
  const r = await t.transcribe(audio(50));
  assert.equal(r.text, '[00:00] Long note');
  assert.equal(r.model, 'gemini:gemini-b');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/upload/v1beta/files')).length, 1, 'uploaded once');
  const gen = JSON.parse(f.calls.find((c) => c.url.includes('gemini-b')).body);
  assert.equal(gen.contents[0].parts[1].file_data.file_uri, 'https://gen/files/f1');
  assert.ok(f.calls.some((c) => c.method === 'DELETE'), 'upload deleted');
});

test('Gemini audio: 429 daily quota is classified for a long cooldown', async () => {
  const f = fakeFetch([{ match: () => true, reply: { status: 429, json: { error: { message: 'Quota exceeded: GenerateRequestsPerDayPerProjectPerModel', details: [{ retryDelay: '3600s' }] } } } }]);
  const p = createGeminiAudioProvider({ apiKey: 'k', fetchImpl: f.impl });
  await assert.rejects(p.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], audio: audio() }), (e) => e.kind === 'quota' && e.retryAfterMs === 3_600_000);
});

test('Whisper: multipart upload, language code, vocabulary prompt, timestamps from segments', async () => {
  let form;
  const f = fakeFetch([
    {
      match: (u) => u.endsWith('/audio/transcriptions'),
      reply: (_u, init) => {
        form = init.body;
        return { json: { text: 'x', duration: 61.2, language: 'english', segments: [{ start: 0, text: 'Hello.' }, { start: 61, text: 'Bye.' }] } };
      },
    },
  ]);
  const p = createWhisperProvider({ apiKey: 'g', fetchImpl: f.impl });
  const out = await p.complete({ model: 'whisper-large-v3-turbo', audio: { ...audio(), name: 'tg.oga' }, language: 'Arabic', vocabulary: 'Hartwell, Omar' });
  assert.equal(out.text, '[00:00] Hello.\n[01:01] Bye.');
  assert.equal(out.durationSeconds, 61);
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
  assert.equal(form.get('language'), 'ar');
  assert.equal(form.get('response_format'), 'verbose_json');
  assert.match(form.get('prompt'), /Hartwell, Omar/);
  assert.equal(form.get('file').name, 'tg.ogg');
  assert.equal(f.calls[0].headers.authorization, 'Bearer g');
  assert.equal(languageCode('fr'), 'fr');
  assert.equal(languageCode('Klingon'), '');
});

test('Whisper: files over the provider limit are skipped (router moves on)', async () => {
  const p = createWhisperProvider({ apiKey: 'g', maxBytes: 10, fetchImpl: async () => assert.fail('should not upload') });
  await assert.rejects(p.complete({ model: 'whisper-large-v3', audio: audio(50) }), (e) => e.kind === 'bad_request');
});

test('audio chain: Gemini overloaded -> Groq Whisper answers', async () => {
  const events = [];
  const providers = {
    gemini: { configured: true, complete: async ({ model }) => Promise.reject(Object.assign(new Error(`${model} 503`), { kind: 'overloaded' })) },
    groq: { configured: true, complete: async () => ({ text: '[00:00] From whisper', durationSeconds: 9 }) },
  };
  const t = createTranscriber({ providers, config: { audio: { chain: 'gemini:a,gemini:b,groq:whisper-large-v3' } }, onEvent: (e) => events.push(e.type) });
  const r = await t.transcribe(audio());
  assert.equal(r.model, 'groq:whisper-large-v3');
  assert.equal(r.durationSeconds, 9);
  assert.equal(events.filter((e) => e === 'failure').length, 2);
});

test('audio chain: everything down -> error with attempts', async () => {
  const providers = { gemini: { configured: true, complete: async () => Promise.reject(Object.assign(new Error('503'), { kind: 'overloaded' })) }, groq: { configured: false } };
  const t = createTranscriber({ providers, config: { audio: { chain: 'gemini:a,groq:whisper-large-v3' } } });
  await assert.rejects(t.transcribe(audio()), (e) => e.attempts.length >= 1);
});

test('analysis JSON parser tolerates fences and prose, rejects missing tasks', () => {
  assert.deepEqual(parseAnalysisJson('```json\n{"tasks":[]}\n```'), { tasks: [] });
  assert.deepEqual(parseAnalysisJson('Here you go: {"tasks":[{"title":"a"}]} hope it helps'), { tasks: [{ title: 'a' }] });
  assert.throws(() => parseAnalysisJson('{"summary":"x"}'), /tasks/);
  assert.throws(() => parseAnalysisJson('no json'), /no JSON/);
});

test('analyzer: invalid JSON from the first model -> next model is used', async () => {
  const router = createLLMRouter({
    chain: [
      { provider: 'a', model: 'm1' },
      { provider: 'b', model: 'm2' },
    ],
    providers: { a: { configured: true, complete: async () => ({ text: 'sorry, I cannot' }) }, b: { configured: true, complete: async () => ({ text: JSON.stringify(DEMO_ANALYSIS) }) } },
  });
  const a = createAnalyzer({ router });
  const r = await a.analyze('[00:00] Sarah, send it by Friday.', { noteDate: '2026-11-10' });
  assert.equal(r.engine, 'ai');
  assert.equal(r.model, 'b:m2');
  assert.equal(r.data.tasks.length, DEMO_ANALYSIS.tasks.length);
});

test('analyzer: all models fail -> keyword rules answer with a warning', async () => {
  const router = createLLMRouter({ chain: [{ provider: 'a', model: 'm1' }], providers: { a: { configured: true, complete: async () => Promise.reject(Object.assign(new Error('down'), { kind: 'overloaded' })) } }, lastChance: false });
  const r = await createAnalyzer({ router }).analyze('[00:00] Sarah, please send the deck by Friday.', { noteDate: '2026-11-10' });
  assert.equal(r.engine, 'rules');
  assert.equal(r.data.tasks[0].owner, 'Sarah');
  assert.match(r.warnings[0], /AI analysis failed/);
});

test('analyzer: no keys at all -> rules without calling anything', async () => {
  const router = createLLMRouter({ chain: [{ provider: 'a', model: 'm' }], providers: { a: { configured: false } } });
  const r = await createAnalyzer({ router }).analyze('I need to call the bank tomorrow.', { noteDate: '2026-11-10' });
  assert.equal(r.engine, 'rules');
  assert.equal(r.data.tasks[0].due_date, '2026-11-11');
});
