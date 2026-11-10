import { findDuePhrase } from './dates.js';

/**
 * Non-AI last resort: a keyword/grammar extractor so a note still produces a usable task
 * list when every model is down or out of quota. English only; results are marked
 * engine "rules" so the user knows to re-run when AI is back (`voice-tasks process --refresh`).
 */

const NOT_NAMES = new Set(['I', 'We', 'You', 'They', 'He', 'She', 'It', 'Please', 'Also', 'Then', 'And', 'But', 'So', 'Okay', 'OK', 'Ok', 'Right', 'The', 'This', 'That', 'Next', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Tomorrow', 'Today', 'Let', 'Lets', 'Make', 'Remind', 'Don', 'Can', 'Could', 'Would', 'Should', 'Need', 'Just', 'Oh', 'Well', 'Now', 'Another', 'One', 'First', 'Second', 'Third', 'Finally', 'Last', 'Speaker', 'Hey', 'Hi', 'Yes', 'No', 'If', 'When', 'After', 'Before', 'Q1', 'Q2', 'Q3', 'Q4', 'Anyway', 'Actually', 'Oh', 'Number', 'Item', 'Point', 'Thing']);
const NAME = "([A-Z][a-z'’]+(?:\\s[A-Z][a-z'’]+)?)";

const DELEGATE_PATTERNS = [
  new RegExp(`\\b(?:ask|tell|get|have|remind|need|want|nudge|chase)\\s+${NAME}\\s+(?:to\\s+)?(.+)`),
  new RegExp(`^${NAME},?\\s+(?:[^.]*?\\b)?(?:please|can you|could you|I need you to|I want you to|I'd like you to|needs to|should|has to|must|will|is going to)\\s+(.+)`),
  // "Jake, find out the venue availability"
  new RegExp(`^${NAME},\\s+(?!(?:i|we|they|he|she|it|you|the|that|this|there|what|if)\\b)([a-z].+)`),
  new RegExp(`\\b${NAME}\\s+(?:needs to|should|has to|must|is going to|will need to)\\s+(.+)`),
];
const SELF_PATTERNS = [
  /\b(?:I need to|I have to|I must|I should|I'll|I will|I'm going to|I want to|I've got to|I gotta|remind me to|note to self:?|don't let me forget to|make sure I)\s+(.+)/i,
];
const TEAM_PATTERNS = [/\b(?:we need to|we have to|we must|we should|we'll|we will|let's|let us|the team (?:needs to|should|has to))\s+(.+)/i];
const GENERIC_PATTERNS = [
  /\b(?:need to|have to|make sure (?:to|that|we|you)?|don't forget to|do not forget to|remember to|please|action item:?|to-?do:?)\s+(.+)/i,
  /^(?:also,?\s+|and\s+|then\s+|oh,?\s+and\s+)?((?:send|call|email|schedule|book|draft|prepare|review|finalize|finalise|set up|organize|organise|follow up|reach out|cancel|confirm|update|share|sign|approve|pay|order|invite|reply|check|fix|write|plan|move|push|chase)\b.+)/i,
];

const HIGH = /\b(urgent|urgently|asap|as soon as possible|immediately|right away|critical|top priority|highest priority|number one priority|time[- ]sensitive|blocking|before anything else|today|tonight|first thing)\b/i;
const LOW = /\b(when you get a chance|no rush|not urgent|eventually|at some point|nice to have|low priority|if you have time|whenever)\b/i;
const DECISION = /\b(we(?:'ve| have)? decided|i(?:'ve| have)? decided|the decision is|let's go with|we(?:'re| are) going (?:with|ahead)|we'll go with|i approve|approved|we agreed|final answer|we(?:'re| are) not going to go)\b/i;
const QUESTION = /\?\s*$|\b(not sure (?:if|whether)|i wonder|we need to figure out|open question|tbd|to be decided)\b/i;
const RISK = /\b(risk|worried|concern(?:ed)?|problem|issue|behind schedule|slipping|delay(?:ed)?|at risk|churn|complain(?:t|ing)|over budget|lawsuit|legal)\b/i;
const IDEA = /\b(idea|what if|maybe we could|we could consider|brainstorm|thinking about|parking lot)\b/i;

const CATEGORY_RULES = [
  ['meeting', /\b(meeting|schedule|calendar|book a|set up a call|catch[- ]up|sync|1:1|one-on-one|invite)\b/i],
  ['follow_up', /\b(follow up|follow-up|chase|check in|circle back|get back to|remind)\b/i],
  ['finance', /\b(invoice|budget|pay|payment|expense|cash|revenue|cost|price|pricing|forecast|p&l|accounts?)\b/i],
  ['people_hiring', /\b(hire|hiring|recruit|interview|candidate|offer letter|onboard|performance review|promotion)\b/i],
  ['sales_clients', /\b(client|customer|deal|proposal|prospect|contract renewal|quote|pipeline|lead)\b/i],
  ['legal_admin', /\b(contract|legal|lawyer|nda|compliance|sign|signature|policy)\b/i],
  ['review_approve', /\b(review|approve|sign off|feedback on|look over|proofread)\b/i],
  ['communication', /\b(email|send|call|message|tell|announce|reply|share|post)\b/i],
  ['research', /\b(research|look into|find out|investigate|compare|analy[sz]e)\b/i],
  ['product', /\b(product|feature|release|launch|roadmap|bug|website|app)\b/i],
  ['operations', /\b(process|vendor|supplier|order|logistics|office|it support|setup|set up)\b/i],
];

const FILLER = /^(?:(?:um+|uh+|so|okay|ok|right|and|also|then|oh|well|now|anyway|actually|alright|next|another thing is|one more thing|the other thing is)[,\s]+)+/i;

function splitSentences(transcript) {
  const out = [];
  for (const raw of String(transcript).split('\n')) {
    const ts = raw.match(/^\s*\[([\d:]+)\]\s*/);
    let line = raw.replace(/^\s*\[[\d:]+\]\s*/, '');
    line = line.replace(/^(?:Speaker \d+|[A-Z][\w .'-]{0,30}):\s+/, '');
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])|;\s+/)) {
      const t = s.trim();
      if (t) out.push({ text: t, timestamp: ts?.[1] || '' });
    }
  }
  return out;
}

const VAGUE = /^(?:think about|do|look at|check|handle|deal with) (?:it|that|this|them)$/i;

/** "call the CFO, so Jake, please block an hour" -> two clauses with their own owners. */
function splitClauses(sentence) {
  return sentence
    .split(/,\s+(?:so|and|then|also|oh and|plus)\s+(?=[A-Z][a-z]+,)|\s+and (?=(?:ask|tell|get|have) [A-Z])|,\s+(?=[A-Z][a-z]+,\s+(?:please|can you|could you|I need you))/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function cleanTitle(s) {
  let t = s
    .replace(FILLER, '')
    .replace(/\s+so (?:that )?(?:I|we) can\b.*$/i, '')
    .replace(/,\s+(?:that's|that is|it's|it is|he|she|they|I|I'll|I want|I'd|so|because|which|since|as|no rush|sometime|the team)\b.*$/i, '')
    .replace(/\b(myself|yourself)\b/gi, '')
    .replace(/\b(please|asap|as soon as possible|urgently|right away|immediately)\b/gi, '')
    .replace(/\b(?:by|before|on|until|no later than)\s+(?:the\s+)?(?:end of (?:the |this |next )?(?:day|week|month|quarter|year)|eod|eow|eom|today|tonight|tomorrow(?: morning| afternoon)?|(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: morning| afternoon| evening)?(?: next week)?|next week|next month|\w+ \d{1,2}(?:st|nd|rd|th)?|the \d{1,2}(?:st|nd|rd|th))\b/gi, '')
    .replace(/\b(?:today|tomorrow|tonight)\b/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:.!-]+$/, '')
    .trim();
  t = t.replace(/^(?:to|that|we|you)\s+/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function categoryOf(text) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'other';
}

function matchTask(sentence) {
  for (const re of DELEGATE_PATTERNS) {
    const m = sentence.match(re);
    if (m && !NOT_NAMES.has(m[1].split(' ')[0])) return { owner: m[1], owner_type: 'delegate', action: m[2] };
  }
  for (const re of SELF_PATTERNS) {
    const m = sentence.match(re);
    if (m) return { owner: 'Me', owner_type: 'self', action: m[1] };
  }
  for (const re of TEAM_PATTERNS) {
    const m = sentence.match(re);
    if (m) return { owner: 'Team', owner_type: 'team', action: m[1] };
  }
  for (const re of GENERIC_PATTERNS) {
    const m = sentence.match(re);
    if (m) return { owner: 'Unassigned', owner_type: 'unassigned', action: m[1] };
  }
  return null;
}

export function extractWithRules(transcript, { noteDate } = {}) {
  const sentences = splitSentences(transcript);
  const tasks = [];
  const decisions = [];
  const open_questions = [];
  const risks = [];
  const ideas = [];
  const people = new Map();

  for (const { text, timestamp } of sentences) {
    for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
      const w = m[1];
      if (!NOT_NAMES.has(w) && m.index > 0 && /\b(ask|tell|with|from|to|and|call|email|cc|have|get|remind)\s+$/i.test(text.slice(0, m.index))) people.set(w, { name: w, role: '' });
    }
    if (DECISION.test(text)) {
      decisions.push({ decision: text, timestamp });
      continue;
    }
    if (QUESTION.test(text) && !/\?\s*$/.test(text)) {
      open_questions.push(text);
      continue;
    }
    let found = false;
    for (const clause of splitClauses(text)) {
      const task = matchTask(clause.replace(FILLER, ''));
      if (!task) continue;
      const title = cleanTitle(task.action);
      if (title.split(' ').length >= 2 && !VAGUE.test(title)) {
        found = true;
        const due = findDuePhrase(clause, noteDate) || findDuePhrase(text, noteDate);
        if (task.owner_type === 'delegate') people.set(task.owner, { name: task.owner, role: '' });
        tasks.push({
          title,
          details: '',
          owner: task.owner,
          owner_type: task.owner_type,
          due_phrase: due?.phrase || '',
          due_date: due?.date || '',
          priority: HIGH.test(text) ? 'high' : LOW.test(text) ? 'low' : 'medium',
          category: categoryOf(clause),
          depends_on: [],
          source_quote: clause.slice(0, 200),
          timestamp,
          confidence: task.owner_type === 'unassigned' ? 0.4 : 0.55,
        });
      }
    }
    if (found) continue;
    if (QUESTION.test(text)) open_questions.push(text);
    else if (RISK.test(text)) risks.push(text);
    else if (IDEA.test(text)) ideas.push(text);
  }

  const first = sentences.slice(0, 2).map((s) => s.text).join(' ');
  const mine = tasks.filter((t) => t.owner_type === 'self').length;
  return {
    title: `Voice note ${noteDate || ''} (keyword extraction)`.replace(/\s+/g, ' '),
    language: 'English',
    summary: `${tasks.length} action item${tasks.length === 1 ? '' : 's'} found by keyword rules (AI was unavailable): ${mine} for you, ${tasks.length - mine} for others or the team. ${first}`.slice(0, 600),
    key_points: [],
    tasks,
    decisions,
    open_questions,
    people: [...people.values()],
    risks,
    ideas,
  };
}
