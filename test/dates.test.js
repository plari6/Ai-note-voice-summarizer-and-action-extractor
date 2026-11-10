import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDuePhrase, resolveDuePhrase } from '../src/dates.js';
import { noteDateFor } from '../src/media.js';

// Tuesday 10 Nov 2026
const REF = '2026-11-10';

test('relative days and weekdays', () => {
  const cases = {
    today: '2026-11-10',
    'by end of day': '2026-11-10',
    EOD: '2026-11-10',
    tomorrow: '2026-11-11',
    'tomorrow morning': '2026-11-11',
    'the day after tomorrow': '2026-11-12',
    'by Thursday': '2026-11-12',
    'Friday morning': '2026-11-13',
    'on Monday': '2026-11-16',
    Tuesday: '2026-11-17', // strictly after the recording day
    'this Friday': '2026-11-13',
    'next Friday': '2026-11-20',
    'next Tuesday': '2026-11-17',
    'Wednesday next week': '2026-11-18',
    'next week': '2026-11-16',
    'sometime next week': '2026-11-16',
    'end of next week': '2026-11-20',
    'end of the week': '2026-11-13',
    EOW: '2026-11-13',
  };
  for (const [phrase, want] of Object.entries(cases)) assert.equal(resolveDuePhrase(phrase, REF), want, phrase);
});

test('durations, months, quarters', () => {
  const cases = {
    'in 3 days': '2026-11-13',
    'within two weeks': '2026-11-24',
    'in a couple of days': '2026-11-12',
    'in a week': '2026-11-17',
    'in 5 business days': '2026-11-17',
    'in two months': '2027-01-10',
    'by the end of the month': '2026-11-30',
    EOM: '2026-11-30',
    'next month': '2026-12-01',
    'end of next month': '2026-12-31',
    'before the end of the quarter': '2026-12-31',
    'end of year': '2026-12-31',
    'November 15': '2026-11-15',
    '15th of December': '2026-12-15',
    'Nov 3rd': '2027-11-03', // already passed this year
    'by the 25th': '2026-11-25',
    'by the 5th': '2026-12-05',
    '2026-12-01': '2026-12-01',
  };
  for (const [phrase, want] of Object.entries(cases)) assert.equal(resolveDuePhrase(phrase, REF), want, phrase);
});

test('no date for vague phrases', () => {
  for (const p of ['asap', 'soon', 'when you get a chance', '', 'whenever']) assert.equal(resolveDuePhrase(p, REF), null, p);
});

test('quarter end in other quarters and month lengths', () => {
  assert.equal(resolveDuePhrase('end of quarter', '2026-02-03'), '2026-03-31');
  assert.equal(resolveDuePhrase('end of the month', '2028-02-10'), '2028-02-29');
  assert.equal(resolveDuePhrase('end of the week', '2026-11-14'), '2026-11-14'); // Saturday: already past Friday
});

test('findDuePhrase pulls the phrase out of a sentence', () => {
  assert.deepEqual(findDuePhrase('Sarah, please get it to me by Thursday so I can review it', REF), { phrase: 'by Thursday', date: '2026-11-12' });
  assert.equal(findDuePhrase('get the page live within two weeks', REF).date, '2026-11-24');
  assert.equal(findDuePhrase('no deadline here', REF), null);
});

test('note date from explicit value, file name, then file time', () => {
  assert.equal(noteDateFor({ explicit: '2026-01-02', name: 'x-2025-05-05.mp3' }), '2026-01-02');
  assert.equal(noteDateFor({ name: 'call-2026-10-28.m4a' }), '2026-10-28');
  assert.equal(noteDateFor({ name: 'PTT-20261105-WA0003.opus' }), '2026-11-05');
  assert.equal(noteDateFor({ name: 'memo 05.11.2026.m4a' }), '2026-11-05');
  assert.equal(noteDateFor({ name: 'memo.m4a', mtime: new Date('2026-03-04T12:00:00Z'), timezone: 'UTC' }), '2026-03-04');
  assert.throws(() => noteDateFor({ explicit: '2026-13-01' }), /Invalid --date/);
});
