import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDelegations, locateQuote, normalizeAnalysis, normalizeOwner, resolveDue } from '../src/analysis.js';
import { DEMO_ANALYSIS, DEMO_DATE, DEMO_TRANSCRIPT } from '../src/demo.js';
import { extractWithRules } from '../src/rules.js';

const opts = { noteDate: DEMO_DATE, transcript: DEMO_TRANSCRIPT, noteId: 'abc123', ownerName: 'Dana' };

test('demo analysis: duplicates merged, sorted by priority then due date', () => {
  const n = normalizeAnalysis(structuredClone(DEMO_ANALYSIS), opts);
  assert.equal(n.tasks.length, 14); // 15 raw, the repeated Hartwell request is merged
  const hartwell = n.tasks.find((t) => /Hartwell proposal/.test(t.title));
  assert.equal(hartwell.mentions, 2);
  assert.equal(n.tasks[0].due_date, '2026-11-10');
  const ranks = n.tasks.map((t) => ({ high: 0, medium: 1, low: 2 })[t.priority]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('depends_on indexes become task ids (and follow merged duplicates)', () => {
  const n = normalizeAnalysis(structuredClone(DEMO_ANALYSIS), opts);
  const call = n.tasks.find((t) => /Call Hartwell/.test(t.title));
  const proposal = n.tasks.find((t) => /Hartwell proposal/.test(t.title));
  const margin = n.tasks.find((t) => /margin/.test(t.title));
  assert.deepEqual(call.depends_on.sort(), [proposal.id, margin.id].sort());
});

test('due date: code-resolved phrase wins over a wrong model date', () => {
  assert.deepEqual(resolveDue({ due_phrase: 'next Friday', due_date: '2026-11-13' }, '2026-11-10'), { due_phrase: 'next Friday', due_date: '2026-11-20', due_source: 'phrase' });
  assert.equal(resolveDue({ due_phrase: 'vendredi prochain', due_date: '2026-11-20' }, '2026-11-10').due_source, 'model');
  assert.equal(resolveDue({ due_phrase: '', due_date: 'soon' }, '2026-11-10').due_date, '');
});

test('owner normalisation', () => {
  assert.deepEqual(normalizeOwner('I', ''), { owner: 'Me', owner_type: 'self' });
  assert.deepEqual(normalizeOwner('Dana', 'delegate', 'Dana'), { owner: 'Me', owner_type: 'self' });
  assert.deepEqual(normalizeOwner('we', ''), { owner: 'Team', owner_type: 'team' });
  assert.deepEqual(normalizeOwner('', 'delegate'), { owner: 'Unassigned', owner_type: 'unassigned' });
  assert.deepEqual(normalizeOwner('sarah', 'self'), { owner: 'Sarah', owner_type: 'delegate' });
  assert.deepEqual(normalizeOwner('Marketing team', 'team'), { owner: 'Marketing team', owner_type: 'team' });
});

test('garbage model output never crashes and is coerced', () => {
  const n = normalizeAnalysis(
    {
      tasks: [
        { title: 'call bank.', owner: 'me', priority: 'URGENT!!', category: 'Finance stuff', confidence: 95, timestamp: '[01:05]' },
        { title: '' },
        null,
        'not an object',
        { title: 'x'.repeat(300), depends_on: ['a', 99, 0] },
      ],
      decisions: ['Go with vendor A', { text: 'Freeze hiring' }],
      people: ['Sarah', { name: 'Me' }, { name: 'sarah' }],
      key_points: 'one point',
    },
    { noteDate: '2026-11-10', noteId: 'n' },
  );
  assert.equal(n.tasks.length, 2);
  const bank = n.tasks.find((t) => t.title === 'Call bank');
  assert.equal(bank.owner_type, 'self');
  assert.equal(bank.priority, 'medium');
  assert.equal(bank.category, 'finance');
  assert.equal(bank.confidence, 0.95);
  assert.equal(bank.timestamp, '01:05');
  assert.ok(n.tasks.find((t) => t.title.length <= 90 && t.title.endsWith('…')));
  assert.deepEqual(n.decisions.map((d) => d.decision), ['Go with vendor A', 'Freeze hiring']);
  assert.deepEqual(n.people.map((p) => p.name), ['Sarah']);
  assert.deepEqual(n.key_points, ['one point']);
  assert.match(n.title, /Voice note/);
});

test('medium task due on the recording day is raised to high', () => {
  const n = normalizeAnalysis({ tasks: [{ title: 'Fix website pricing', owner: 'Team', priority: 'medium', due_phrase: 'today' }] }, { noteDate: '2026-11-10' });
  assert.equal(n.tasks[0].priority, 'high');
});

test('timestamp found from the quote when the model omits it', () => {
  assert.equal(locateQuote('Omar needs to send a corrected version', DEMO_TRANSCRIPT), '01:06');
  assert.equal(locateQuote('not in there at all', DEMO_TRANSCRIPT), '');
});

test('delegation messages group tasks per person', () => {
  const n = normalizeAnalysis(structuredClone(DEMO_ANALYSIS), opts);
  const d = buildDelegations(n.tasks, { noteDate: DEMO_DATE, ownerName: 'Dana' });
  assert.deepEqual(d.map((x) => x.owner).sort(), ['Jake', 'Omar', 'Priya', 'Sarah']);
  const jake = d.find((x) => x.owner === 'Jake');
  assert.equal(jake.task_ids.length, 3);
  assert.match(jake.message, /^Hi Jake,/);
  assert.match(jake.message, /Block one hour.*by Fri 13 Nov/);
  assert.match(jake.message, /Thanks,\nDana$/);
});

test('rule-based fallback finds owners, due dates and priorities without AI', () => {
  const raw = extractWithRules(DEMO_TRANSCRIPT, { noteDate: DEMO_DATE });
  const n = normalizeAnalysis(raw, { noteDate: DEMO_DATE, transcript: DEMO_TRANSCRIPT, noteId: 'r' });
  const find = (re) => n.tasks.find((t) => re.test(t.title));
  assert.ok(n.tasks.length >= 10, `only ${n.tasks.length} tasks`);
  assert.equal(find(/revised proposal/).owner, 'Sarah');
  assert.equal(find(/revised proposal/).due_date, '2026-11-12');
  assert.equal(find(/corrected version/).owner, 'Omar');
  assert.equal(find(/corrected version/).priority, 'high');
  assert.equal(find(/Call Hartwell/).owner, 'Me');
  assert.equal(find(/Block an hour/).owner, 'Jake');
  assert.equal(find(/pipeline review/).owner, 'Sarah');
  assert.equal(find(/venue availability/).priority, 'low');
  assert.equal(find(/expense policy/).owner_type, 'team');
  assert.ok(raw.decisions.some((d) => /freeze the two junior/i.test(d.decision)));
  assert.ok(raw.open_questions.some((q) => /Lisbon/.test(q)));
  assert.ok(raw.risks.some((r) => /worried/.test(r)));
});
