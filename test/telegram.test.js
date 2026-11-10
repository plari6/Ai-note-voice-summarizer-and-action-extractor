import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTelegramBot } from '../src/telegram.js';
import { fakeFetch, fakeTranscriber, setup, wav } from './helpers.js';

function bot(opts = {}) {
  const sent = [];
  const docs = [];
  const f = fakeFetch([
    { match: (u) => u.endsWith('/getFile'), reply: { json: { ok: true, result: { file_path: 'voice/file_1.oga' } } } },
    { match: (u) => u.includes('/file/botTOKEN/voice/file_1.oga'), reply: { body: wav(1) } },
    {
      match: (u) => u.endsWith('/sendMessage'),
      reply: (_u, init) => {
        sent.push(JSON.parse(init.body));
        return { json: { ok: true, result: { message_id: sent.length } } };
      },
    },
    {
      match: (u) => u.endsWith('/sendDocument'),
      reply: (_u, init) => {
        docs.push(init.body.get('document').name);
        return { json: { ok: true, result: {} } };
      },
    },
    { match: () => true, reply: { json: { ok: true, result: true } } },
  ]);
  const s = setup(opts);
  s.config.telegram.allowed = opts.allowed ?? ['42'];
  const b = createTelegramBot({ token: 'TOKEN', pipeline: s.pipeline, store: s.store, config: s.config, fetchImpl: f.impl, log: () => {} });
  return { b, sent, docs, f, s };
}

const voice = (chat = 42) => ({ update_id: 1, message: { message_id: 7, date: Date.UTC(2026, 10, 10, 9) / 1000, chat: { id: chat }, from: { id: chat }, voice: { file_id: 'F1', mime_type: 'audio/ogg', file_size: 9000 } } });

test('voice note -> tasks message, calendar and CSV files, delegation messages', async () => {
  const { b, sent, docs, s } = bot();
  await b.handleUpdate(voice());
  const all = sent.map((m) => m.text).join('\n');
  assert.match(all, /Post-board brain dump/);
  assert.match(all, /Delegated to Sarah/);
  assert.match(all, /Ready-to-forward messages/);
  assert.deepEqual(docs, ['tasks-2026-11-10.ics', 'tasks-2026-11-10.csv']);
  assert.equal(s.store.listTasks().length, 14);
  assert.ok(sent.every((m) => m.parse_mode === 'HTML' && m.text.length <= 4096));
});

test('commands: /tasks, /done, /today, /help', async () => {
  const { b, sent, s } = bot();
  await b.handleUpdate(voice());
  sent.length = 0;
  await b.handleUpdate({ update_id: 2, message: { message_id: 8, chat: { id: 42 }, text: '/tasks Sarah' } });
  assert.match(sent[0].text, /Open tasks for Sarah<\/b> \(2\)/);
  const id = s.store.listTasks({ owner: 'Sarah' })[0].id;
  await b.handleUpdate({ update_id: 3, message: { message_id: 9, chat: { id: 42 }, text: `/done ${id}` } });
  assert.match(sent[1].text, /^Done:/);
  await b.handleUpdate({ update_id: 4, message: { message_id: 10, chat: { id: 42 }, text: '/today' } });
  assert.match(sent[2].text, /Due today or overdue/);
  await b.handleUpdate({ update_id: 5, message: { message_id: 11, chat: { id: 42 }, text: '/help' } });
  assert.match(sent[3].text, /Your chat id: <code>42<\/code>/);
});

test('unknown chats are refused and nothing is downloaded', async () => {
  const { b, sent, f } = bot();
  await b.handleUpdate(voice(99));
  assert.match(sent[0].text, /This bot is private/);
  assert.ok(!f.calls.some((c) => c.url.endsWith('/getFile')));
});

test('AI down: note is queued and the user is told', async () => {
  const { b, sent, s } = bot({ transcriber: fakeTranscriber({ fail: 'busy' }) });
  await b.handleUpdate(voice());
  assert.match(sent.at(-1).text, /saved and I'll send the tasks automatically/);
  const pending = s.store.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].meta.chat_id, 42);
  assert.equal(pending[0].meta.date, '2026-11-10');
});

test('long pasted text is processed like a transcript', async () => {
  const { b, sent } = bot();
  await b.handleUpdate({ update_id: 6, message: { message_id: 12, chat: { id: 42 }, text: 'Sarah please send me the revised proposal by Thursday and I need to call the bank tomorrow morning about the loan' } });
  assert.match(sent.map((m) => m.text).join('\n'), /tasks/);
});
