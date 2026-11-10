import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_TRANSCRIPT } from '../src/demo.js';
import { createServer } from '../src/server.js';
import { fakeTranscriber, setup, wav } from './helpers.js';

async function start(opts = {}) {
  const s = setup(opts);
  const app = createServer({ ...s });
  const server = await new Promise((r) => {
    const srv = app.listen(0, () => r(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...s, base, close: () => new Promise((r) => server.close(r)) };
}

test('page, health, JSON text note, markdown format, tasks API', async () => {
  const s = await start();
  try {
    assert.match(await (await fetch(`${s.base}/`)).text(), /Voice note → task list/);
    const health = await (await fetch(`${s.base}/health`)).json();
    assert.equal(health.ok, true);

    const res = await fetch(`${s.base}/api/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: DEMO_TRANSCRIPT, date: '2026-11-10' }) });
    assert.equal(res.status, 200);
    const note = await res.json();
    assert.equal(note.stats.tasks, 14);
    assert.equal(note.transcript, undefined, 'transcript left out by default');

    const md = await (await fetch(`${s.base}/api/notes?format=md`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: DEMO_TRANSCRIPT, date: '2026-11-10' }) })).text();
    assert.match(md, /^# Post-board brain dump/);

    const tasks = await (await fetch(`${s.base}/api/tasks?owner=Sarah`)).json();
    assert.equal(tasks.length, 2);
    const done = await fetch(`${s.base}/api/tasks/${tasks[0].id}/done`, { method: 'POST' });
    assert.equal((await done.json()).status, 'done');
    assert.equal((await fetch(`${s.base}/api/tasks/TNOPE/done`, { method: 'POST' })).status, 404);
    assert.match(await (await fetch(`${s.base}/api/tasks.ics`)).text(), /BEGIN:VCALENDAR/);
    assert.match(await (await fetch(`${s.base}/api/tasks.csv`)).text(), /^﻿?id,title/);
    assert.equal((await (await fetch(`${s.base}/api/notes`)).json()).length, 1);
  } finally {
    await s.close();
  }
});

test('multipart upload of a browser recording without extension', async () => {
  const s = await start();
  try {
    const form = new FormData();
    form.append('file', new Blob([wav(1)], { type: 'audio/webm;codecs=opus' }), 'blob');
    form.append('date', '2026-11-10');
    const res = await fetch(`${s.base}/api/notes`, { method: 'POST', body: form });
    const note = await res.json();
    assert.equal(res.status, 200, JSON.stringify(note));
    assert.equal(note.source.file, 'blob.webm');
    assert.equal(note.source.kind, 'audio');
  } finally {
    await s.close();
  }
});

test('bearer token required when API_TOKEN is set; bad input is 400', async () => {
  const s = await start({ env: { API_TOKEN: 'tok' } });
  try {
    assert.equal((await fetch(`${s.base}/api/tasks`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/tasks`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${s.base}/api/tasks`, { headers: { authorization: 'Bearer tok' } })).status, 200);
    assert.equal((await fetch(`${s.base}/health`)).status, 200, 'health stays public');
    const bad = await fetch(`${s.base}/api/notes`, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 400);
  } finally {
    await s.close();
  }
});

test('AI down: upload is queued (202) instead of lost', async () => {
  const s = await start({ transcriber: fakeTranscriber({ fail: 'busy' }) });
  try {
    const form = new FormData();
    form.append('file', new Blob([wav(1)], { type: 'audio/wav' }), 'n.wav');
    const res = await fetch(`${s.base}/api/notes`, { method: 'POST', body: form });
    assert.equal(res.status, 202);
    assert.equal((await res.json()).queued, true);
    assert.equal(s.store.listPending().length, 1);
  } finally {
    await s.close();
  }
});

test('upload over the size limit is 413', async () => {
  const s = await start({ env: { MAX_UPLOAD_MB: '0.001' } });
  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(5000)], { type: 'audio/wav' }), 'big.wav');
    assert.equal((await fetch(`${s.base}/api/notes`, { method: 'POST', body: form })).status, 413);
  } finally {
    await s.close();
  }
});
