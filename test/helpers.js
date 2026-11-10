import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPipeline } from '../src/pipeline.js';
import { createStore } from '../src/store.js';
import { getConfig } from '../src/config.js';
import { DEMO_ANALYSIS } from '../src/demo.js';

export const tmpDir = (prefix = 'vt-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** fetch stub: handlers tried in order; records every call. */
export function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    for (const h of handlers) {
      if (h.match(String(url), init)) {
        h.count = (h.count || 0) + 1;
        const r = typeof h.reply === 'function' ? await h.reply(String(url), init, h.count) : h.reply;
        return response(r);
      }
    }
    throw new Error(`Unexpected fetch ${init.method || 'GET'} ${url}`);
  };
  return { impl, calls };
}

export function response({ status = 200, json, text, headers = {}, body } = {}) {
  const raw = text ?? (json !== undefined ? JSON.stringify(json) : '');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => raw,
    json: async () => JSON.parse(raw || '{}'),
    arrayBuffer: async () => (body || Buffer.from(raw)).buffer.slice(0),
  };
}

export const geminiText = (text, finishReason = 'STOP') => ({ json: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } } });

export function fakeTranscriber({ text = '[00:01] Sarah, please send the proposal by Friday.\n[00:05] I need to call the bank tomorrow.', fail = null } = {}) {
  const t = {
    calls: 0,
    enabledCount: 1,
    status: () => [{ id: 'fake:audio', state: 'ready', enabled: true }],
    async transcribe() {
      t.calls++;
      if (fail) throw Object.assign(new Error(fail), { attempts: [{ target: 'fake:audio', kind: 'overloaded' }] });
      return { text, model: 'fake:audio', truncated: false, durationSeconds: 12 };
    },
  };
  return t;
}

export function fakeAnalyzer({ data = DEMO_ANALYSIS, engine = 'ai' } = {}) {
  const a = {
    calls: 0,
    status: () => [],
    async analyze(transcript, opts) {
      a.calls++;
      a.last = { transcript, opts };
      return { data: structuredClone(data), engine, model: engine === 'ai' ? 'fake:model' : 'rules', warnings: engine === 'ai' ? [] : ['rules used'] };
    },
  };
  return a;
}

export function setup({ transcriber = fakeTranscriber(), analyzer = fakeAnalyzer(), env = {}, fetchImpl } = {}) {
  const dir = tmpDir();
  const config = getConfig({ DATA_DIR: path.join(dir, 'data'), OUTPUT_DIR: path.join(dir, 'out'), TIMEZONE: 'UTC', ...env });
  const store = createStore(config.dataDir);
  const pipeline = createPipeline({ config, store, transcriber, analyzer, fetchImpl, sleep: async () => {} });
  return { dir, config, store, pipeline, transcriber, analyzer };
}

/** Minimal valid WAV (silence) for upload tests. */
export function wav(seconds = 1, rate = 8000) {
  const data = Buffer.alloc(rate * 2 * seconds);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
