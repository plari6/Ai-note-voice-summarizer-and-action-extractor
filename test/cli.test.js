import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEMO_TRANSCRIPT } from '../src/demo.js';
import { tmpDir } from './helpers.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'voice-tasks.js');

function run(args, dir) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, VOICE_TASKS_SKIP_DOTENV: '1', DATA_DIR: path.join(dir, 'data'), OUTPUT_DIR: path.join(dir, 'out'), TIMEZONE: 'UTC' };
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', cwd: dir });
}

test('demo runs offline and writes the report', () => {
  const dir = tmpDir();
  const r = run(['demo', '--out', path.join(dir, 'demo')], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /14 tasks: 4 yours, 9 delegated/);
  assert.ok(fs.readdirSync(path.join(dir, 'demo')).some((f) => f.endsWith('.ics')));
});

test('process a transcript without keys -> rules, then tasks / done / history', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'ceo-2026-11-10.txt');
  fs.writeFileSync(file, DEMO_TRANSCRIPT);
  const r = run(['process', file], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /keyword extractor/);
  const list = JSON.parse(run(['tasks', '--json'], dir).stdout);
  assert.ok(list.length >= 10);
  const done = run(['done', list[0].id], dir);
  assert.match(done.stdout, /done:/);
  assert.equal(JSON.parse(run(['tasks', '--json'], dir).stdout).length, list.length - 1);
  assert.match(run(['history'], dir).stdout, /2026-11-10/);
  assert.equal(run(['done', 'TNOPE'], dir).status, 1);
});

test('audio without any key is queued with exit code 2', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'memo.wav');
  fs.writeFileSync(file, Buffer.alloc(100));
  const r = run(['process', file], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Queued/);
  assert.match(run(['retry'], dir).stdout, /still pending/);
});

test('doctor reports missing keys and both chains', () => {
  const dir = tmpDir();
  const r = run(['doctor'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--  GEMINI_API_KEY/);
  assert.match(r.stdout, /Audio chain/);
  assert.match(r.stdout, /disabled gemini:gemini-3.6-flash \(no API key\)/);
});

test('unsupported file type is a clear error', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'x.pdf'), 'x');
  const r = run(['process', path.join(dir, 'x.pdf')], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unsupported file type/);
});
