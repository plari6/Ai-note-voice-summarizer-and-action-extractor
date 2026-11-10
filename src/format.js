import { formatDue } from './dates.js';

const PRIORITY_LABEL = { high: 'HIGH', medium: 'MED', low: 'LOW' };
const CATEGORY_LABEL = {
  follow_up: 'Follow-up',
  meeting: 'Meeting',
  communication: 'Communication',
  review_approve: 'Review / approve',
  decision: 'Decision',
  research: 'Research',
  people_hiring: 'People / hiring',
  finance: 'Finance',
  sales_clients: 'Sales / clients',
  product: 'Product',
  operations: 'Operations',
  legal_admin: 'Legal / admin',
  personal: 'Personal',
  other: 'Other',
};
export const categoryLabel = (c) => CATEGORY_LABEL[c] || c;

const mdEscape = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const dueText = (t) => (t.due_date ? `${formatDue(t.due_date)}${t.due_phrase ? ` ("${t.due_phrase}")` : ''}` : t.due_phrase ? `"${t.due_phrase}"` : '');

/** Groups in reading order: mine, each delegate, team, unassigned. */
export function groupTasks(tasks) {
  const groups = [];
  const mine = tasks.filter((t) => t.owner_type === 'self');
  if (mine.length) groups.push({ label: 'Your tasks', tasks: mine });
  const delegates = [...new Set(tasks.filter((t) => t.owner_type === 'delegate').map((t) => t.owner))];
  for (const d of delegates) groups.push({ label: `Delegated to ${d}`, tasks: tasks.filter((t) => t.owner_type === 'delegate' && t.owner === d) });
  const team = tasks.filter((t) => t.owner_type === 'team');
  if (team.length) groups.push({ label: 'Team', tasks: team });
  const none = tasks.filter((t) => t.owner_type === 'unassigned');
  if (none.length) groups.push({ label: 'Unassigned (pick an owner)', tasks: none });
  return groups;
}

export function toMarkdown(note) {
  const s = note.stats;
  const out = [];
  out.push(`# ${note.title}`, '');
  out.push(
    `**Recorded:** ${formatDue(note.recorded_on)} ${note.recorded_on.slice(0, 4)}` +
      (note.duration_seconds ? ` · **Length:** ${Math.round(note.duration_seconds / 60) || '<1'} min` : '') +
      ` · **Tasks:** ${s.tasks} (${s.mine} yours, ${s.delegated} delegated, ${s.high} high priority)` +
      (note.language ? ` · **Language:** ${note.language}` : ''),
  );
  out.push(`<sub>Source: ${note.source.file} · transcript: ${note.transcript_engine} · analysis: ${note.analysis_engine}</sub>`, '');
  for (const w of note.warnings || []) out.push(`> **Note:** ${w}`, '');
  if (note.summary) out.push('## Summary', '', note.summary, '');
  if (note.key_points.length) out.push(...note.key_points.map((k) => `- ${k}`), '');

  out.push('## Action items', '');
  if (!note.tasks.length) out.push('_No action items found._', '');
  for (const g of groupTasks(note.tasks)) {
    out.push(`### ${g.label}`, '');
    for (const t of g.tasks) {
      const meta = [`**${PRIORITY_LABEL[t.priority]}**`, dueText(t) && `due ${dueText(t)}`, categoryLabel(t.category), t.timestamp && `at ${t.timestamp}`, t.mentions > 1 && `said ${t.mentions}x`, t.depends_on.length && `after ${t.depends_on.join(', ')}`].filter(Boolean).join(' · ');
      out.push(`- [ ] **${t.title}** \`${t.id}\``);
      out.push(`  ${meta}`);
      if (t.details) out.push(`  ${t.details}`);
      if (t.source_quote) out.push(`  > "${t.source_quote}"`);
    }
    out.push('');
  }

  out.push('## Task table', '', '| ID | Task | Owner | Due | Priority | Category |', '|---|---|---|---|---|---|');
  for (const t of note.tasks) out.push(`| ${t.id} | ${mdEscape(t.title)} | ${mdEscape(t.owner)} | ${t.due_date || '-'} | ${t.priority} | ${categoryLabel(t.category)} |`);
  out.push('');

  if (note.decisions.length) out.push('## Decisions', '', ...note.decisions.map((d) => `- ${d.decision}${d.timestamp ? ` _(${d.timestamp})_` : ''}`), '');
  if (note.open_questions.length) out.push('## Open questions', '', ...note.open_questions.map((q) => `- ${q}`), '');
  if (note.risks.length) out.push('## Risks and concerns', '', ...note.risks.map((r) => `- ${r}`), '');
  if (note.ideas.length) out.push('## Ideas / parking lot', '', ...note.ideas.map((r) => `- ${r}`), '');
  if (note.people.length) out.push('## People mentioned', '', ...note.people.map((p) => `- **${p.name}**${p.role ? ` - ${p.role}` : ''}`), '');

  if (note.delegations.length) {
    out.push('## Delegation messages (ready to send)', '');
    for (const d of note.delegations) out.push(`### To ${d.owner}: ${d.subject}`, '', '```text', d.message, '```', '');
  }
  if (note.transcript) out.push('<details><summary>Full transcript</summary>', '', '```text', note.transcript, '```', '', '</details>', '');
  return out.join('\n');
}

/** Excel-friendly CSV (BOM, CRLF) with formula-injection protection. */
export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n')}\r\n`;
}

export const TASK_COLUMNS = ['id', 'title', 'details', 'owner', 'owner_type', 'due_date', 'due_phrase', 'priority', 'category', 'status', 'depends_on', 'timestamp', 'source_quote', 'confidence', 'note_title', 'recorded_on'];

export function tasksCsv(tasks, note) {
  return toCsv(tasks.map((t) => ({ note_title: note?.title, recorded_on: note?.recorded_on, ...t })), TASK_COLUMNS);
}

/** Calendar file: one all-day event per task with a due date (imports into Outlook, Google, Apple). */
export function toIcs(tasks, { calendarName = 'Voice note tasks' } = {}) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;
    const parts = [];
    let cur = '';
    for (const ch of line) {
      if (Buffer.byteLength(cur + ch, 'utf8') > (parts.length ? 74 : 75)) {
        parts.push(cur);
        cur = '';
      }
      cur += ch;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//voice-tasks//AI Voice Note Action Extractor//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calendarName)}`];
  for (const t of tasks.filter((x) => x.due_date)) {
    const day = t.due_date.replace(/-/g, '');
    const next = new Date(`${t.due_date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const desc = [t.details, `Owner: ${t.owner}`, `Priority: ${t.priority}`, t.source_quote && `Said: "${t.source_quote}"`, t.note_title && `From: ${t.note_title}`, `Task ID: ${t.id}`].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@voice-tasks`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${esc(`${t.owner_type === 'self' ? '' : `[${t.owner}] `}${t.title}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      `PRIORITY:${t.priority === 'high' ? 1 : t.priority === 'medium' ? 5 : 9}`,
      `CATEGORIES:${esc(categoryLabel(t.category))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Short text for terminals and logs. */
export function toConsole(note) {
  const s = note.stats;
  const lines = [`${note.title}  [${note.recorded_on}]`, `  ${s.tasks} tasks: ${s.mine} yours, ${s.delegated} delegated${s.delegates.length ? ` (${s.delegates.join(', ')})` : ''}, ${s.team} team, ${s.unassigned} unassigned · ${s.high} high priority · ${s.with_due} with a due date`];
  if (note.summary) lines.push(`  ${note.summary}`);
  for (const t of note.tasks) lines.push(`  [${PRIORITY_LABEL[t.priority].padEnd(4)}] ${t.id} ${t.title} -> ${t.owner}${t.due_date ? `, due ${formatDue(t.due_date)}` : ''}`);
  return lines.join('\n');
}

export function taskBoard(tasks, { today } = {}) {
  if (!tasks.length) return 'No tasks.';
  return tasks
    .map((t) => {
      const late = t.due_date && today && t.due_date < today ? ' OVERDUE' : '';
      return `[${PRIORITY_LABEL[t.priority].padEnd(4)}] ${t.id}  ${t.title}\n        ${t.owner}${t.due_date ? ` · due ${formatDue(t.due_date)}${late}` : ''} · ${t.status} · from "${t.note_title || ''}" (${t.recorded_on || ''})`;
    })
    .join('\n');
}

const htmlEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export { htmlEscape };

/** Telegram HTML (parse_mode=HTML), split into messages under 4096 characters. */
export function toTelegram(note) {
  const s = note.stats;
  const head = [`<b>${htmlEscape(note.title)}</b>`, `${s.tasks} tasks · ${s.mine} yours · ${s.delegated} delegated · ${s.high} high priority`];
  if (note.summary) head.push('', htmlEscape(note.summary));
  for (const w of note.warnings || []) head.push('', `<i>${htmlEscape(w)}</i>`);
  const parts = [head.join('\n')];
  for (const g of groupTasks(note.tasks)) {
    const lines = [`<b>${htmlEscape(g.label)}</b>`];
    for (const t of g.tasks) lines.push(`${t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪'} ${htmlEscape(t.title)}${t.due_date ? ` · <i>${htmlEscape(formatDue(t.due_date))}</i>` : ''} <code>${t.id}</code>`);
    parts.push(lines.join('\n'));
  }
  if (note.decisions.length) parts.push(`<b>Decisions</b>\n${note.decisions.map((d) => `• ${htmlEscape(d.decision)}`).join('\n')}`);
  if (note.open_questions.length) parts.push(`<b>Open questions</b>\n${note.open_questions.map((q) => `• ${htmlEscape(q)}`).join('\n')}`);
  const messages = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + '\n\n' + p).length > 3900 && cur) {
      messages.push(cur);
      cur = p.slice(0, 3900);
    } else cur = cur ? `${cur}\n\n${p}` : p.slice(0, 3900);
  }
  if (cur) messages.push(cur);
  return messages;
}

export function toSlack(note) {
  const s = note.stats;
  const taskLines = note.tasks.slice(0, 25).map((t) => `• *${t.title.replace(/[*_~]/g, '')}* - ${t.owner}${t.due_date ? `, due ${formatDue(t.due_date)}` : ''}${t.priority === 'high' ? ' :red_circle:' : ''}`);
  return {
    text: `Voice note processed: ${note.title} (${s.tasks} tasks)`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: note.title.slice(0, 150) } },
      { type: 'section', text: { type: 'mrkdwn', text: `${note.summary || ''}\n\n*${s.tasks} tasks* · ${s.mine} for the exec · ${s.delegated} delegated · ${s.high} high priority`.slice(0, 2900) } },
      ...(taskLines.length ? [{ type: 'section', text: { type: 'mrkdwn', text: taskLines.join('\n').slice(0, 2900) } }] : []),
      ...(note.decisions.length ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `*Decisions:* ${note.decisions.map((d) => d.decision).join(' | ')}`.slice(0, 2900) }] }] : []),
    ],
  };
}
