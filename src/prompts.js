import { weekdayOf } from './dates.js';

export const SCHEMA_VERSION = 1;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const CATEGORIES = ['follow_up', 'meeting', 'communication', 'review_approve', 'decision', 'research', 'people_hiring', 'finance', 'sales_clients', 'product', 'operations', 'legal_admin', 'personal', 'other'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const OWNER_TYPES = ['self', 'delegate', 'team', 'unassigned'];

export function transcriptionPrompt({ language = '', vocabulary = '', ownerName = '' } = {}) {
  return [
    'Transcribe this voice note word for word.',
    '- Output plain text only, one line per sentence or short group of sentences.',
    '- Start every line with the time it begins in square brackets: [mm:ss] (or [h:mm:ss] past one hour).',
    '- It is usually one person dictating. If more than one person speaks, prefix lines with the speaker name if it is said, otherwise "Speaker 1:", "Speaker 2:".',
    ownerName ? `- The main speaker is ${ownerName}.` : '',
    '- Keep names, numbers, amounts, dates and deadlines exactly as spoken. Drop filler sounds (um, uh) but keep every instruction.',
    '- Mark unclear words as [inaudible]. Do not summarise, translate or add anything.',
    language ? `- The note is in ${language}; transcribe in that language.` : '- Transcribe in the language spoken (keep mixed languages as spoken).',
    vocabulary ? `- These names and terms may appear, spell them this way: ${vocabulary}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function analysisSystem({ ownerName = '', context = '', outputLanguage = 'English' } = {}) {
  const lang = /^auto$/i.test(outputLanguage) ? 'the same language as the voice note' : outputLanguage;
  return `You are the chief of staff of a busy executive. You turn their long, rambling voice notes into a clean, complete task list they can act on and delegate.
${ownerName ? `The executive (the speaker, "Me") is ${ownerName}.` : 'The speaker is the executive ("Me").'}
${context ? `About the executive and their company: ${context}` : ''}

Rules:
- Extract EVERY action the note asks for, including small ones said in passing. One task per action: split "call Sarah and send her the deck" into two tasks.
- Never invent tasks, names, amounts or deadlines that are not in the note. If something is vague, keep it vague and lower the confidence.
- title: short, starts with a verb, specific ("Send Q3 board deck to Sarah", not "Deck"). Max 90 characters.
- owner: the person who must do it. Use the exact name said in the note. If the executive will do it themselves ("I need to", "remind me"), owner = "Me" and owner_type = "self". If they ask someone else, owner_type = "delegate". "We"/"the team" = "team". Not clear = "Unassigned" / "unassigned".
- due_phrase: the deadline words exactly as spoken ("by next Friday", "end of the month", "tomorrow morning"), or "" if none. due_date: your best YYYY-MM-DD for it based on the recording date, or "".
- priority: high = urgent, blocking, money/clients/legal at risk, or due within 2 days; low = "when you get a chance", nice to have; otherwise medium.
- source_quote: the shortest verbatim words from the transcript that ask for the task (max 25 words). timestamp: its [mm:ss] from the transcript, or "".
- depends_on: 0-based indexes of tasks that must be done first, or [].
- decisions: things the executive decided or approved (not tasks). open_questions: things still to find out or decide.
- people: everyone named, with their role/relationship if said.
- risks: problems, worries or deadlines at risk mentioned.
- ideas: ideas or "parking lot" thoughts that are not tasks yet.
- summary: 2-3 sentences for someone who will not listen to the note. key_points: up to 7 bullets.
- Write titles, details and summaries in ${lang}. Keep names as spoken.
- Answer with ONE JSON object only, no Markdown.`;
}

export function analysisPrompt(transcript, { noteDate, title = '' } = {}) {
  const day = noteDate ? WEEKDAYS[weekdayOf(noteDate)] : '';
  return `Recording date: ${noteDate || 'unknown'}${day ? ` (${day})` : ''}
${title ? `File: ${title}\n` : ''}
Return JSON with exactly this shape:
{
  "title": "short title for this note (max 70 chars)",
  "language": "language the note is spoken in",
  "summary": "2-3 sentences",
  "key_points": ["..."],
  "tasks": [
    {
      "title": "Verb-first task",
      "details": "context needed to do it, or \\"\\"",
      "owner": "Me | <name> | team | Unassigned",
      "owner_type": "${OWNER_TYPES.join(' | ')}",
      "due_phrase": "words as spoken or \\"\\"",
      "due_date": "YYYY-MM-DD or \\"\\"",
      "priority": "${PRIORITIES.join(' | ')}",
      "category": "${CATEGORIES.join(' | ')}",
      "depends_on": [],
      "source_quote": "verbatim words",
      "timestamp": "mm:ss or \\"\\"",
      "confidence": 0.0
    }
  ],
  "decisions": [{ "decision": "...", "timestamp": "" }],
  "open_questions": ["..."],
  "people": [{ "name": "...", "role": "..." }],
  "risks": ["..."],
  "ideas": ["..."]
}

Voice note transcript:
"""
${transcript}
"""`;
}
