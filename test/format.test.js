import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDelegations, normalizeAnalysis, noteStats } from '../src/analysis.js';
import { DEMO_ANALYSIS, DEMO_DATE, DEMO_TRANSCRIPT } from '../src/demo.js';
import { toCsv, toIcs, toMarkdown, toSlack, toTelegram } from '../src/format.js';
import { parseTranscript, transcriptDuration } from '../src/transcript.js';
import { segmentsToLines } from '../src/transcription/whisper.js';

function demoNote() {
  const n = normalizeAnalysis(structuredClone(DEMO_ANALYSIS), { noteDate: DEMO_DATE, transcript: DEMO_TRANSCRIPT, noteId: 'demo' });
  return { ...n, id: 'demo', recorded_on: DEMO_DATE, source: { file: 'x.txt' }, transcript: DEMO_TRANSCRIPT, transcript_engine: 'provided', analysis_engine: 'fake', warnings: [], delegations: buildDelegations(n.tasks, { noteDate: DEMO_DATE }), stats: noteStats(n.tasks, DEMO_DATE) };
}

test('markdown report has every section', () => {
  const md = toMarkdown(demoNote());
  for (const h of ['## Summary', '## Action items', '### Your tasks', '### Delegated to Sarah', '### Team', '## Task table', '## Decisions', '## Open questions', '## Risks and concerns', '## People mentioned', '## Delegation messages', 'Full transcript']) assert.ok(md.includes(h), h);
  assert.match(md, /- \[ \] \*\*Send corrected Q3 board deck/);
  assert.match(md, /said 2x/);
});

test('CSV escapes quotes and blocks spreadsheet formulas', () => {
  const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'say "hi", ok', c: ['x', 'y'] }], ['a', 'b', 'c']);
  assert.ok(csv.startsWith('﻿a,b,c\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"say ""hi"", ok"'));
  assert.ok(csv.includes('"x; y"'));
});

test('ICS: one all-day event per dated task, escaped and folded', () => {
  const note = demoNote();
  const ics = toIcs(note.tasks);
  const events = ics.match(/BEGIN:VEVENT/g).length;
  assert.equal(events, note.tasks.filter((t) => t.due_date).length);
  assert.match(ics, /DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113/);
  assert.match(ics, /SUMMARY:\[Sarah\] Send revised Hartwell proposal/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded at 75 octets');
  assert.ok(ics.includes('\\,'), 'commas escaped');
});

test('Telegram messages stay under the 4096 limit', () => {
  const note = demoNote();
  note.tasks = Array.from({ length: 120 }, (_, i) => ({ ...note.tasks[0], id: `T${i}`, title: `Task number ${i} with a reasonably long title to fill space` }));
  const msgs = toTelegram(note);
  assert.ok(msgs.length > 1);
  assert.ok(msgs.every((m) => m.length <= 4096));
  assert.ok(toTelegram({ ...demoNote(), title: '<b>&' })[0].startsWith('<b>&lt;b&gt;&amp;</b>'));
});

test('Slack payload has header and tasks', () => {
  const s = toSlack(demoNote());
  assert.equal(s.blocks[0].type, 'header');
  assert.match(s.blocks[2].text.text, /Sarah/);
});

test('transcript parsers: VTT, SRT, JSON, plain', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Dana>Sarah, send the deck.\n\n00:00:05.000 --> 00:00:07.000\n<v Dana>By Friday.\n\n00:01:10.000 --> 00:01:12.000\nOmar: Got it.';
  assert.equal(parseTranscript(vtt, 'a.vtt'), '[00:01] Dana: Sarah, send the deck. By Friday.\n[01:10] Omar: Got it.');
  const srt = '1\n00:00:02,000 --> 00:00:03,000\nHello there\n\n2\n01:00:05,000 --> 01:00:06,000\nLater';
  assert.equal(parseTranscript(srt, 'a.srt'), '[00:02] Hello there\n[1:00:05] Later');
  assert.equal(parseTranscript(JSON.stringify({ segments: [{ start: 3, text: ' Hi ' }, { start: 65, speaker: 'B', text: 'Yo' }] }), 'a.json'), '[00:03] Hi\n[01:05] B: Yo');
  assert.equal(parseTranscript(JSON.stringify({ text: 'plain' }), 'a.json'), 'plain');
  assert.equal(parseTranscript('﻿Just text\r\n\r\n\r\nmore', 'a.txt'), 'Just text\n\nmore');
  assert.equal(transcriptDuration(DEMO_TRANSCRIPT), 140);
});

test('Whisper segments merge into sentence lines with start times', () => {
  const lines = segmentsToLines([{ start: 0, text: 'Okay so' }, { start: 1.5, text: 'first thing.' }, { start: 63, text: 'Sarah, call me.' }]);
  assert.equal(lines, '[00:00] Okay so first thing.\n[01:03] Sarah, call me.');
});
