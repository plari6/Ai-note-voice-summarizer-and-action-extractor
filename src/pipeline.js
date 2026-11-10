import fs from 'node:fs';
import path from 'node:path';
import { buildDelegations, normalizeAnalysis, noteStats } from './analysis.js';
import { tasksCsv, toIcs, toMarkdown } from './format.js';
import { sendSlack, sendWebhook } from './integrations.js';
import { kindOf, mimeOf, noteDateFor, sha256, slugify, wavDurationSeconds } from './media.js';
import { SCHEMA_VERSION } from './prompts.js';
import { parseTranscript, transcriptDuration, wordCount } from './transcript.js';

export class TranscriptionError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = 'TRANSCRIPTION_FAILED';
    this.attempts = attempts;
  }
}

/**
 * voice note -> transcript (cached) -> analysis (cached when AI) -> normalised note
 *  -> files (md, json, transcript, csv, ics) -> task register -> webhook / Slack
 */
export function createPipeline({ config, store, transcriber, analyzer, fetchImpl = fetch, sleep, log = () => {} }) {
  async function loadInput(input) {
    if (input.text !== undefined) {
      const name = input.name || 'note.txt';
      return { kind: 'transcript', name, text: parseTranscript(input.text, name), bytes: Buffer.byteLength(input.text), mtime: input.mtime };
    }
    if (input.path) {
      const buffer = fs.readFileSync(input.path);
      const name = path.basename(input.path);
      const kind = kindOf(name);
      if (!kind) throw new Error(`Unsupported file type: ${name}`);
      const mtime = fs.statSync(input.path).mtime;
      if (kind === 'transcript') return { kind, name, file: input.path, text: parseTranscript(buffer.toString('utf8'), name), bytes: buffer.length, mtime };
      return { kind, name, file: input.path, buffer, mime: mimeOf(name), bytes: buffer.length, mtime };
    }
    if (input.buffer) {
      const name = input.name || 'voice-note.ogg';
      const kind = kindOf(name) || 'audio';
      if (kind === 'transcript') return { kind, name, text: parseTranscript(input.buffer.toString('utf8'), name), bytes: input.buffer.length, mtime: input.mtime };
      return { kind, name, buffer: input.buffer, mime: input.mime || mimeOf(name), bytes: input.buffer.length, mtime: input.mtime };
    }
    throw new Error('processInput: give { path }, { buffer, name } or { text }');
  }

  async function getTranscript(src, opts) {
    const hash = sha256(src.buffer);
    const language = opts.language ?? config.noteLanguage;
    const key = `${hash}-${slugify(language || 'auto', 20)}`;
    const cached = !opts.refresh && store.getCache('transcripts', key);
    if (cached) return { ...cached, hash, cached: true };
    if (src.bytes > config.audio.maxBytes) throw new Error(`${src.name} is ${(src.bytes / 1048576).toFixed(0)} MB, over MAX_AUDIO_MB (${Math.round(config.audio.maxBytes / 1048576)})`);
    if (!transcriber.enabledCount) throw new TranscriptionError('No transcription provider configured. Set GEMINI_API_KEY (or GROQ_API_KEY), or pass a transcript file.');
    log(`Transcribing ${src.name} (${(src.bytes / 1048576).toFixed(1)} MB)...`);
    let r;
    try {
      r = await transcriber.transcribe({ buffer: src.buffer, mime: src.mime, name: src.name, sha256: hash }, { language, vocabulary: opts.vocabulary ?? config.vocabulary, ownerName: opts.ownerName ?? config.ownerName });
    } catch (err) {
      throw new TranscriptionError(`Could not transcribe ${src.name}: ${err.message}`, err.attempts);
    }
    const value = { text: r.text, model: r.model, truncated: r.truncated, duration_seconds: r.durationSeconds ?? wavDurationSeconds(src.buffer) ?? transcriptDuration(r.text), created_at: new Date().toISOString() };
    store.setCache('transcripts', key, value);
    return { ...value, hash, cached: false };
  }

  async function processInput(input, opts = {}) {
    const src = await loadInput(input);
    const warnings = [];
    const recorded_on = noteDateFor({ explicit: opts.date, name: src.name, mtime: src.mtime, timezone: config.timezone });

    let transcript;
    let transcriptEngine;
    let hash;
    let duration = null;
    if (src.kind === 'audio') {
      const t = await getTranscript(src, opts);
      transcript = t.text;
      transcriptEngine = `${t.model}${t.cached ? ' (cached)' : ''}`;
      hash = t.hash;
      duration = t.duration_seconds;
      if (t.truncated) warnings.push('The transcript hit the model output limit and may be cut off at the end. Split very long recordings.');
    } else {
      transcript = src.text;
      transcriptEngine = 'provided transcript';
      hash = sha256(transcript);
      duration = transcriptDuration(transcript);
    }
    if (wordCount(transcript) < 3) throw new Error(`${src.name}: the transcript is empty (silent or unreadable recording).`);

    const ownerName = opts.ownerName ?? config.ownerName;
    const context = opts.context ?? config.context;
    const outputLanguage = opts.outputLanguage ?? config.outputLanguage;
    const noteId = hash.slice(0, 12);
    const aKey = sha256(JSON.stringify([SCHEMA_VERSION, transcript, recorded_on, ownerName, context, outputLanguage])).slice(0, 32);

    let analysis = !opts.refresh && !opts.noAi && store.getCache('analysis', aKey);
    if (analysis) analysis = { ...analysis, cached: true };
    else {
      log(`Extracting tasks from ${src.name}...`);
      analysis = await analyzer.analyze(transcript, { noteDate: recorded_on, ownerName, context, outputLanguage, title: src.name, noAi: opts.noAi });
      if (analysis.engine === 'ai') store.setCache('analysis', aKey, { data: analysis.data, engine: analysis.engine, model: analysis.model, created_at: new Date().toISOString() });
    }
    warnings.push(...(analysis.warnings || []));

    const n = normalizeAnalysis(analysis.data, { noteDate: recorded_on, transcript, ownerName, noteId, fileName: src.name });
    const note = {
      schema_version: SCHEMA_VERSION,
      id: noteId,
      title: n.title,
      recorded_on,
      processed_at: new Date().toISOString(),
      language: n.language,
      duration_seconds: duration,
      source: { file: src.name, kind: src.kind, bytes: src.bytes, sha256: hash },
      summary: n.summary,
      key_points: n.key_points,
      tasks: n.tasks,
      decisions: n.decisions,
      open_questions: n.open_questions,
      people: n.people,
      risks: n.risks,
      ideas: n.ideas,
      delegations: buildDelegations(n.tasks, { noteDate: recorded_on, ownerName }),
      stats: noteStats(n.tasks, recorded_on),
      transcript_engine: transcriptEngine,
      analysis_engine: `${analysis.engine === 'rules' ? 'keyword rules (no AI)' : analysis.model}${analysis.cached ? ' (cached)' : ''}`,
      warnings,
      transcript,
      outputs: {},
    };

    if (opts.write !== false) note.outputs = writeOutputs(note, opts.out || config.outDir);
    if (opts.register !== false) {
      store.registerTasks(note);
      store.addNote(note);
    }
    note.integrations = await runIntegrations(note, opts);
    return note;
  }

  function writeOutputs(note, outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, `${note.recorded_on}-${slugify(note.title)}-${note.id.slice(0, 4)}`);
    const files = { markdown: `${base}.md`, json: `${base}.json`, transcript: `${base}.transcript.txt`, csv: `${base}.tasks.csv` };
    fs.writeFileSync(files.markdown, toMarkdown(note));
    fs.writeFileSync(files.transcript, `${note.transcript}\n`);
    fs.writeFileSync(files.csv, tasksCsv(note.tasks, note));
    if (note.tasks.some((t) => t.due_date)) {
      files.ics = `${base}.ics`;
      fs.writeFileSync(files.ics, toIcs(note.tasks.map((t) => ({ ...t, note_title: note.title })), { calendarName: note.title }));
    }
    fs.writeFileSync(files.json, JSON.stringify({ ...note, outputs: files }, null, 2));
    return files;
  }

  async function runIntegrations(note, opts) {
    const results = {};
    const webhook = opts.webhook === false ? '' : opts.webhook || config.webhookUrl;
    const slack = opts.slack === false ? '' : opts.slack || config.slackWebhookUrl;
    if (webhook) {
      try {
        await sendWebhook(webhook, note, { secret: config.webhookSecret, fetchImpl, sleep });
        results.webhook = 'sent';
      } catch (err) {
        results.webhook = `failed: ${err.message}`;
        note.warnings.push(`Webhook failed: ${err.message}`);
      }
    }
    if (slack) {
      try {
        await sendSlack(slack, note, { fetchImpl, sleep });
        results.slack = 'sent';
      } catch (err) {
        results.slack = `failed: ${err.message}`;
        note.warnings.push(`Slack failed: ${err.message}`);
      }
    }
    return results;
  }

  /** Retry queued audio (AI was down earlier). Returns processed notes. */
  async function retryPending(opts = {}, onDone = async () => {}) {
    const done = [];
    for (const item of store.listPending()) {
      if (!item.file || !fs.existsSync(item.file)) {
        store.removePending(item);
        continue;
      }
      try {
        const note = await processInput({ path: item.file }, { ...item.meta, ...opts });
        store.removePending(item);
        done.push(note);
        await onDone(note, item);
      } catch (err) {
        if (!(err instanceof TranscriptionError)) store.removePending(item);
        else store.updatePending({ ...item, tries: (item.tries || 1) + 1, error: err.message, last_try: new Date().toISOString() });
        log(`Retry of ${item.name || item.file} failed: ${err.message}`);
      }
    }
    return done;
  }

  return { processInput, retryPending, writeOutputs };
}
