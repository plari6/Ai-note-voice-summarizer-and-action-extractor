import crypto from 'node:crypto';
import { daysBetween, formatDue, resolveDuePhrase } from './dates.js';
import { isIsoDate } from './media.js';
import { CATEGORIES, OWNER_TYPES, PRIORITIES } from './prompts.js';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const str = (v, max = 2000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);

function cut(s, max) {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  return `${head.slice(0, head.lastIndexOf(' ') > max * 0.6 ? head.lastIndexOf(' ') : head.length).replace(/[,;:\s-]+$/, '')}…`;
}

const strList = (v, max = 15, len = 400) => {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const s = str(typeof x === 'object' && x ? x.text || x.point || x.question || x.risk || x.idea || JSON.stringify(x) : x, len);
    const k = s.toLowerCase();
    if (s && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out.slice(0, max);
};

export function normalizeTimestamp(v) {
  const m = str(v).replace(/[[\]()]/g, '').match(/^(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return m[1] ? `${Number(m[1])}:${m[2].padStart(2, '0')}:${m[3]}` : `${m[2].padStart(2, '0')}:${m[3]}`;
}

/** Find the [mm:ss] of the transcript line containing a quote. */
export function locateQuote(quote, transcript) {
  if (!quote || !transcript) return '';
  const words = quote.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  if (words.length < 2) return '';
  const probe = words.slice(0, Math.min(5, words.length)).join(' ');
  for (const line of String(transcript).split('\n')) {
    const lw = (line.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []).join(' ');
    if (lw.includes(probe)) return normalizeTimestamp(line.match(/^\[([\d:]+)\]/)?.[1] || '');
  }
  return '';
}

function coerceEnum(v, allowed, fallback) {
  const s = str(v).toLowerCase().replace(/[\s/-]+/g, '_');
  if (allowed.includes(s)) return s;
  return allowed.find((a) => s && (a.includes(s) || s.includes(a))) || fallback;
}

const SELF = /^(me|i|myself|self|speaker|the speaker|executive|the executive|ceo|boss)$/i;
const TEAM = /^(team|the team|we|us|everyone|all|our team|leadership team)$/i;
const NOBODY = /^(|unassigned|unknown|none|n\/a|tbd|someone|anyone)$/i;

export function normalizeOwner(owner, type, ownerName = '') {
  let o = str(owner, 80).replace(/^@/, '');
  let t = coerceEnum(type, OWNER_TYPES, '');
  const me = ownerName && o.toLowerCase() === ownerName.toLowerCase();
  if (SELF.test(o) || me) return { owner: 'Me', owner_type: 'self' };
  if (TEAM.test(o)) return { owner: 'Team', owner_type: 'team' };
  if (NOBODY.test(o)) return t === 'self' ? { owner: 'Me', owner_type: 'self' } : { owner: 'Unassigned', owner_type: 'unassigned' };
  if (!t || t === 'unassigned' || t === 'self') t = 'delegate';
  if (t === 'team') return { owner: o, owner_type: 'team' };
  o = o.replace(/\b\w/g, (c) => c.toUpperCase());
  return { owner: o, owner_type: 'delegate' };
}

/** Pick the due date: code-resolved phrase first (reliable maths), then the model's date. */
export function resolveDue({ due_phrase, due_date }, noteDate) {
  const phrase = str(due_phrase, 120);
  const fromPhrase = phrase ? resolveDuePhrase(phrase, noteDate) : null;
  if (fromPhrase) return { due_phrase: phrase, due_date: fromPhrase, due_source: 'phrase' };
  const model = str(due_date, 10);
  if (isIsoDate(model)) return { due_phrase: phrase, due_date: model, due_source: 'model' };
  return { due_phrase: phrase, due_date: '', due_source: '' };
}

const titleKey = (t) =>
  t
    .toLowerCase()
    .replace(/\b(the|a|an|to|for|with|and|of|on|about|my|our|please)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 60);

export const taskId = (noteId, title, owner) => `T${crypto.createHash('sha1').update(`${noteId}|${titleKey(title)}|${owner}`).digest('hex').slice(0, 6).toUpperCase()}`;

export function normalizeTasks(rawTasks, { noteDate, transcript = '', ownerName = '', noteId = '' } = {}) {
  const input = Array.isArray(rawTasks) ? rawTasks : [];
  const tasks = [];
  const indexMap = new Map(); // raw index -> kept task
  const byKey = new Map();
  input.forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const title = cut(str(t.title || t.task || t.action, 300).replace(/[.;:]+$/, ''), 90);
    if (!title) return;
    const title2 = title.charAt(0).toUpperCase() + title.slice(1);
    const { owner, owner_type } = normalizeOwner(t.owner ?? t.assignee, t.owner_type, ownerName);
    const due = resolveDue(t, noteDate);
    let priority = coerceEnum(t.priority, PRIORITIES, 'medium');
    if (due.due_date && noteDate && daysBetween(noteDate, due.due_date) <= 0 && priority === 'medium') priority = 'high';
    const source_quote = str(t.source_quote || t.quote, 300);
    const conf = Number(t.confidence);
    const task = {
      id: '',
      title: title2,
      details: str(t.details || t.description, 600),
      owner,
      owner_type,
      ...due,
      priority,
      category: coerceEnum(t.category, CATEGORIES, 'other'),
      depends_on: (Array.isArray(t.depends_on) ? t.depends_on : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < input.length && n !== i),
      source_quote,
      timestamp: normalizeTimestamp(t.timestamp) || locateQuote(source_quote, transcript),
      confidence: Number.isFinite(conf) ? Math.round(Math.min(1, Math.max(0, conf > 1 ? conf / 100 : conf)) * 100) / 100 : 0.7,
      status: 'open',
    };
    const key = `${titleKey(task.title)}|${owner.toLowerCase()}`;
    const dup = byKey.get(key);
    if (dup) {
      // Executives repeat themselves in long notes: merge instead of listing twice.
      if (!dup.due_date && task.due_date) Object.assign(dup, { due_date: task.due_date, due_phrase: task.due_phrase, due_source: task.due_source });
      if (PRIORITY_RANK[task.priority] < PRIORITY_RANK[dup.priority]) dup.priority = task.priority;
      if (!dup.details && task.details) dup.details = task.details;
      dup.mentions = (dup.mentions || 1) + 1;
      indexMap.set(i, dup);
      return;
    }
    task.id = taskId(noteId, task.title, owner);
    byKey.set(key, task);
    indexMap.set(i, task);
    tasks.push(task);
  });
  for (const t of tasks) t.depends_on = [...new Set(t.depends_on.map((n) => indexMap.get(n)?.id).filter((id) => id && id !== t.id))];
  return sortTasks(tasks);
}

export function sortTasks(tasks) {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => PRIORITY_RANK[a.t.priority] - PRIORITY_RANK[b.t.priority] || (a.t.due_date || '9999').localeCompare(b.t.due_date || '9999') || a.i - b.i)
    .map((x) => x.t);
}

export function normalizeAnalysis(raw, { noteDate, transcript = '', ownerName = '', noteId = '', fileName = '' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const tasks = normalizeTasks(r.tasks || r.action_items, { noteDate, transcript, ownerName, noteId });
  const decisions = (Array.isArray(r.decisions) ? r.decisions : [])
    .map((d) => (typeof d === 'string' ? { decision: str(d, 400), timestamp: '' } : { decision: str(d?.decision || d?.text, 400), timestamp: normalizeTimestamp(d?.timestamp) }))
    .filter((d) => d.decision)
    .slice(0, 20);
  const seenPeople = new Set();
  const people = (Array.isArray(r.people) ? r.people : [])
    .map((p) => (typeof p === 'string' ? { name: str(p, 80), role: '' } : { name: str(p?.name, 80), role: str(p?.role, 160) }))
    .filter((p) => p.name && !SELF.test(p.name) && !seenPeople.has(p.name.toLowerCase()) && seenPeople.add(p.name.toLowerCase()))
    .slice(0, 30);
  const title = cut(str(r.title, 200), 70) || (tasks[0] ? `Voice note: ${tasks[0].title}` : `Voice note ${noteDate || ''}`.trim()) || fileName;
  return {
    title,
    language: str(r.language, 40),
    summary: str(r.summary, 1500),
    key_points: strList(r.key_points, 7),
    tasks,
    decisions,
    open_questions: strList(r.open_questions),
    people,
    risks: strList(r.risks),
    ideas: strList(r.ideas),
  };
}

export function noteStats(tasks, noteDate) {
  const owners = new Set(tasks.filter((t) => t.owner_type === 'delegate').map((t) => t.owner));
  return {
    tasks: tasks.length,
    mine: tasks.filter((t) => t.owner_type === 'self').length,
    delegated: tasks.filter((t) => t.owner_type === 'delegate').length,
    team: tasks.filter((t) => t.owner_type === 'team').length,
    unassigned: tasks.filter((t) => t.owner_type === 'unassigned').length,
    high: tasks.filter((t) => t.priority === 'high').length,
    with_due: tasks.filter((t) => t.due_date).length,
    due_within_2_days: tasks.filter((t) => t.due_date && noteDate && daysBetween(noteDate, t.due_date) <= 2).length,
    delegates: [...owners],
  };
}

/** Ready-to-send message per person the executive delegated to (no extra AI call). */
export function buildDelegations(tasks, { noteDate, ownerName = '' } = {}) {
  const groups = new Map();
  for (const t of tasks) {
    if (t.owner_type !== 'delegate') continue;
    if (!groups.has(t.owner)) groups.set(t.owner, []);
    groups.get(t.owner).push(t);
  }
  return [...groups.entries()].map(([owner, list]) => {
    const first = owner.split(/\s+/)[0];
    const lines = list.map((t, i) => {
      const bits = [t.due_date ? `by ${formatDue(t.due_date)}` : '', t.priority === 'high' ? 'high priority' : ''].filter(Boolean).join(', ');
      return `${i + 1}. ${t.title}${bits ? ` (${bits})` : ''}${t.details ? `\n   ${t.details}` : ''}`;
    });
    const subject = list.length === 1 ? list[0].title : `${list.length} action items from my notes${noteDate ? ` (${formatDue(noteDate)})` : ''}`;
    const message = `Hi ${first},\n\n${list.length === 1 ? 'Could you take care of this' : 'Could you take care of these'}:\n\n${lines.join('\n')}\n\nLet me know if anything is unclear or the timing doesn't work.\n\nThanks,\n${ownerName || ''}`.trim();
    return { owner, task_ids: list.map((t) => t.id), subject, message };
  });
}
