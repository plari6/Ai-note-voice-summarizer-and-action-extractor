import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEMO_TRANSCRIPT } from '../src/demo.js';
import { TranscriptionError } from '../src/pipeline.js';
import { createWatcher } from '../src/watch.js';
import { fakeAnalyzer, fakeFetch, fakeTranscriber, setup, wav } from './helpers.js';

test('audio note: transcribe, analyse, write all outputs, register tasks', async () => {
  const s = setup();
  const file = path.join(s.dir, 'board-2026-11-10.wav');
  fs.writeFileSync(file, wav(2));
  const note = await s.pipeline.processInput({ path: file });
  assert.equal(note.recorded_on, '2026-11-10'); // from the file name
  assert.equal(note.source.kind, 'audio');
  assert.equal(note.duration_seconds, 12); // transcriber value wins over the wav header
  assert.equal(note.stats.tasks, 14);
  assert.equal(note.transcript_engine, 'fake:audio');
  for (const k of ['markdown', 'json', 'transcript', 'csv', 'ics']) assert.ok(fs.existsSync(note.outputs[k]), k);
  const json = JSON.parse(fs.readFileSync(note.outputs.json, 'utf8'));
  assert.equal(json.tasks.length, 14);
  assert.equal(s.store.listTasks().length, 14);
  assert.equal(s.store.listNotes().length, 1);
  assert.equal(s.analyzer.last.opts.noteDate, '2026-11-10');
});

test('cache: same audio is transcribed and analysed once; --refresh redoes both', async () => {
  const s = setup();
  const file = path.join(s.dir, 'n.wav');
  fs.writeFileSync(file, wav(1));
  await s.pipeline.processInput({ path: file }, { date: '2026-11-10' });
  const again = await s.pipeline.processInput({ path: file }, { date: '2026-11-10' });
  assert.equal(s.transcriber.calls, 1);
  assert.equal(s.analyzer.calls, 1);
  assert.match(again.transcript_engine, /cached/);
  assert.match(again.analysis_engine, /cached/);
  await s.pipeline.processInput({ path: file }, { date: '2026-11-10', refresh: true });
  assert.equal(s.transcriber.calls, 2);
  assert.equal(s.analyzer.calls, 2);
});

test('rules results are not cached (AI is retried next time)', async () => {
  const s = setup({ analyzer: fakeAnalyzer({ engine: 'rules', data: { tasks: [{ title: 'Call the bank', owner: 'Me' }] } }) });
  await s.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: 'a.txt' }, { date: '2026-11-10' });
  await s.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: 'a.txt' }, { date: '2026-11-10' });
  assert.equal(s.analyzer.calls, 2);
});

test('done status survives re-processing the same note', async () => {
  const s = setup();
  const note = await s.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: 'x.txt' }, { date: '2026-11-10' });
  const id = note.tasks[0].id;
  s.store.setTaskStatus([id.toLowerCase()], 'done');
  await s.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: 'x.txt' }, { date: '2026-11-10' });
  assert.equal(s.store.listTasks({ status: 'done' })[0].id, id);
  assert.equal(s.store.listTasks().length, 13);
  assert.equal(s.store.listTasks({ owner: 'sarah' }).length, 2);
  assert.equal(s.store.listTasks({ owner: 'me' }).every((t) => t.owner_type === 'self'), true);
  assert.equal(s.store.listTasks({ overdue: true, today: '2026-11-20' }).length > 0, true);
});

test('transcription failure throws TranscriptionError; retryPending processes the queue later', async () => {
  const transcriber = fakeTranscriber({ fail: 'all models busy' });
  const s = setup({ transcriber });
  await assert.rejects(s.pipeline.processInput({ buffer: wav(1), name: 'tg.ogg' }), TranscriptionError);
  s.store.addPending({ buffer: wav(1), name: 'tg.ogg', meta: { date: '2026-11-10', chat_id: 5 } });
  assert.equal((await s.pipeline.retryPending()).length, 0);
  assert.equal(s.store.listPending()[0].tries, 2);
  transcriber.transcribe = async () => ({ text: DEMO_TRANSCRIPT, model: 'fake:audio' });
  const delivered = [];
  const done = await s.pipeline.retryPending({}, async (n, item) => delivered.push(item.meta.chat_id));
  assert.equal(done.length, 1);
  assert.equal(done[0].recorded_on, '2026-11-10');
  assert.deepEqual(delivered, [5]);
  assert.equal(s.store.listPending().length, 0);
});

test('empty transcript and unsupported files are rejected clearly', async () => {
  const s = setup({ transcriber: fakeTranscriber({ text: '[00:00] ...' }) });
  await assert.rejects(s.pipeline.processInput({ buffer: wav(1), name: 'silence.wav' }), /transcript is empty/);
  await assert.rejects(s.pipeline.processInput({ text: 'hi', name: 'a.txt' }), /empty/);
});

test('webhook gets the note + tasks with an HMAC signature; Slack gets blocks; failures become warnings', async () => {
  const f = fakeFetch([
    { match: (u) => u === 'https://hooks.example/zap', reply: { status: 200, text: 'ok' } },
    { match: (u) => u === 'https://slack.example/hook', reply: { status: 500, text: 'nope' } },
  ]);
  const s = setup({ fetchImpl: f.impl, env: { WEBHOOK_URL: 'https://hooks.example/zap', WEBHOOK_SECRET: 's3cret', SLACK_WEBHOOK_URL: 'https://slack.example/hook' } });
  const note = await s.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: 'a.txt' }, { date: '2026-11-10' });
  const call = f.calls.find((c) => c.url.includes('hooks.example'));
  const body = JSON.parse(call.body);
  assert.equal(body.event, 'voice_note.processed');
  assert.equal(body.tasks.length, 14);
  assert.equal(body.tasks[0].note_id, note.id);
  assert.equal(call.headers['x-voice-tasks-signature'], `sha256=${crypto.createHmac('sha256', 's3cret').update(call.body).digest('hex')}`);
  assert.equal(note.integrations.webhook, 'sent');
  assert.match(note.integrations.slack, /failed/);
  assert.equal(f.calls.filter((c) => c.url.includes('slack')).length, 3, 'retried on 5xx');
  assert.ok(note.warnings.some((w) => /Slack failed/.test(w)));
  const off = await s.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: 'b.txt' }, { date: '2026-11-10', webhook: false, slack: false });
  assert.deepEqual(off.integrations, {});
});

test('watcher processes a new file once it stops growing, and only once', async () => {
  const s = setup();
  const inbox = path.join(s.dir, 'inbox');
  fs.mkdirSync(inbox);
  fs.writeFileSync(path.join(inbox, 'memo-2026-11-10.wav'), wav(1));
  fs.writeFileSync(path.join(inbox, 'notes.pdf'), 'ignored');
  const seen = [];
  const w = createWatcher({ folder: inbox, pipeline: s.pipeline, store: s.store, log: () => {}, onNote: async (n) => seen.push(n.id) });
  await w.scan(); // first sight: size recorded only
  assert.equal(seen.length, 0);
  await w.scan();
  assert.equal(seen.length, 1);
  await w.scan();
  assert.equal(seen.length, 1);
});
