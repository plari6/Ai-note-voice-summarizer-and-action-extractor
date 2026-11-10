#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import { createApp, createServer, createTelegramBot, createWatcher, TranscriptionError } from '../src/index.js';
import { loadEnv, PROJECT_ROOT } from '../src/config.js';
import { DEMO_ANALYSIS, DEMO_DATE, DEMO_NAME, DEMO_TRANSCRIPT } from '../src/demo.js';
import { taskBoard, tasksCsv, toConsole, toIcs } from '../src/format.js';
import { collectFiles, localIsoDate, mimeOf, sha256, slugify } from '../src/media.js';

loadEnv();
const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const program = new Command();
let quiet = false;
const log = (...a) => !quiet && console.error(...a);
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

program.name('voice-tasks').description('Turn long executive voice notes into a prioritised, delegated task list.').version(pkg.version);

const noteOptions = (cmd) =>
  cmd
    .option('-d, --date <YYYY-MM-DD>', 'recording date (resolves "tomorrow", "next Friday"); default: date in file name, else file time')
    .option('-l, --language <lang>', 'language spoken in the note (default: auto-detect)')
    .option('-o, --output-language <lang>', 'language of the task list, or "auto" for the note\'s language (default: OUTPUT_LANGUAGE or English)')
    .option('--owner <name>', 'name of the person speaking (shown as "Me")')
    .option('--context <text>', 'who the speaker is / what the company does (better owners and wording)')
    .option('--vocab <terms>', 'names and terms to spell correctly, comma separated')
    .option('--out <dir>', 'output folder (default: OUTPUT_DIR or ./output)')
    .option('--refresh', 'ignore cached transcripts and analyses')
    .option('--no-ai', 'skip AI analysis and use the keyword extractor (transcripts only)')
    .option('--webhook <url>', 'POST the result to this URL (Zapier, Make, n8n)')
    .option('--no-webhook', 'do not call WEBHOOK_URL / SLACK_WEBHOOK_URL')
    .option('--slack <url>', 'post a summary to this Slack incoming webhook')
    .addOption(new Option('--simulate-outage <providers>', 'make these providers fail with 503 to demo the fallback, e.g. gemini').argParser(list));

const pipelineOpts = (o) => ({
  date: o.date,
  language: o.language,
  outputLanguage: o.outputLanguage,
  ownerName: o.owner,
  context: o.context,
  vocabulary: o.vocab,
  out: o.out ? path.resolve(o.out) : undefined,
  refresh: o.refresh,
  noAi: o.ai === false,
  webhook: o.webhook === false ? false : o.webhook,
  slack: o.webhook === false ? false : o.slack,
  write: o.write !== false,
});

noteOptions(program.command('process').alias('summarize').argument('<inputs...>', 'audio files, transcripts or folders').description('Transcribe voice notes and extract tasks'))
  .option('--json', 'print the full result as JSON on stdout')
  .option('--no-write', 'do not write output files')
  .option('-q, --quiet', 'no progress logs')
  .action(async (inputs, o) => {
    quiet = Boolean(o.quiet || o.json);
    const app = createApp({ log, simulate: o.simulateOutage || [] });
    const files = collectFiles(inputs);
    if (!files.length) throw new Error('No supported files found.');
    const results = [];
    let failed = 0;
    for (const file of files) {
      try {
        const note = await app.pipeline.processInput({ path: file }, pipelineOpts(o));
        results.push(note);
        if (!o.json) {
          console.log(`\n${toConsole(note)}`);
          for (const w of note.warnings) console.log(`  ! ${w}`);
          if (note.outputs.markdown) console.log(`  Report: ${note.outputs.markdown}${note.outputs.ics ? `\n  Calendar: ${note.outputs.ics}` : ''}`);
          for (const [k, v] of Object.entries(note.integrations || {})) console.log(`  ${k}: ${v}`);
        }
      } catch (err) {
        failed++;
        if (err instanceof TranscriptionError) {
          const id = app.store.addPending({ sourcePath: file, name: path.basename(file), meta: { ...pipelineOpts(o), out: o.out ? path.resolve(o.out) : undefined }, error: err.message });
          console.error(`\n${path.basename(file)}: ${err.message}\n  Queued (${id}). Run "voice-tasks retry" when AI is back, or pass a transcript file.`);
        } else console.error(`\n${path.basename(file)}: ${err.message}`);
      }
    }
    if (o.json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    if (failed) process.exitCode = failed === files.length ? 2 : 1;
  });

program
  .command('transcribe')
  .argument('<audio>', 'audio file')
  .option('-l, --language <lang>', 'language spoken')
  .option('--vocab <terms>', 'names and terms to spell correctly')
  .option('--refresh', 'ignore the transcript cache')
  .option('--save <file>', 'write the transcript to a file')
  .description('Transcript only, with [mm:ss] timestamps')
  .action(async (file, o) => {
    const app = createApp({ log });
    const [audio] = collectFiles([file]);
    const buffer = fs.readFileSync(audio);
    const key = `${sha256(buffer)}-${slugify(o.language || app.config.noteLanguage || 'auto', 20)}`;
    let t = !o.refresh && app.store.getCache('transcripts', key);
    if (!t) {
      const r = await app.transcriber.transcribe({ buffer, mime: mimeOf(audio), name: path.basename(audio), sha256: sha256(buffer) }, { language: o.language, vocabulary: o.vocab ?? app.config.vocabulary, ownerName: app.config.ownerName });
      t = { text: r.text, model: r.model };
      log(`Transcribed with ${r.model}`);
    }
    if (o.save) fs.writeFileSync(o.save, `${t.text}\n`);
    console.log(t.text);
  });

program
  .command('demo')
  .description('Run the sample CEO voice note (offline, no keys needed)')
  .option('--live', 'use the real AI chain on the sample transcript')
  .option('--rules', 'show what the no-AI keyword extractor produces')
  .option('--out <dir>', 'output folder', path.join(PROJECT_ROOT, 'output', 'demo'))
  .action(async (o) => {
    const env = { ...process.env, DATA_DIR: path.join(process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data'), 'demo') };
    const fake = { analyze: async () => ({ data: structuredClone(DEMO_ANALYSIS), engine: 'ai', model: 'sample AI output (offline demo)', warnings: [] }), status: () => [] };
    const app = createApp({ env, log, analyzer: o.live || o.rules ? undefined : fake });
    const note = await app.pipeline.processInput({ text: DEMO_TRANSCRIPT, name: DEMO_NAME }, { date: DEMO_DATE, out: path.resolve(o.out), refresh: true, noAi: Boolean(o.rules), webhook: false, ownerName: 'Dana (CEO)' });
    console.log(toConsole(note));
    for (const w of note.warnings) console.log(`  ! ${w}`);
    console.log(`\nReport: ${note.outputs.markdown}\nTasks CSV: ${note.outputs.csv}\nCalendar: ${note.outputs.ics}\nJSON: ${note.outputs.json}`);
  });

program
  .command('tasks')
  .description('Task register across all notes')
  .option('--owner <name>', 'only this owner ("me" for your own)')
  .option('--done', 'show completed tasks')
  .option('--all', 'open and done')
  .option('--overdue', 'only overdue')
  .option('--today', 'due today or overdue')
  .option('--week', 'due in the next 7 days')
  .option('--csv <file>', 'export to CSV')
  .option('--ics <file>', 'export due dates to a calendar file')
  .option('--json', 'print JSON')
  .action((o) => {
    const app = createApp({ log });
    const today = localIsoDate(new Date(), app.config.timezone);
    const rows = app.store.listTasks({ status: o.all ? 'all' : o.done ? 'done' : 'open', owner: o.owner, overdue: o.overdue, dueWithin: o.today ? 0 : o.week ? 7 : undefined, today });
    if (o.csv) fs.writeFileSync(o.csv, tasksCsv(rows));
    if (o.ics) fs.writeFileSync(o.ics, toIcs(rows));
    if (o.json) return console.log(JSON.stringify(rows, null, 2));
    console.log(taskBoard(rows, { today }));
    console.log(`\n${rows.length} task(s).${o.csv ? ` CSV: ${o.csv}` : ''}${o.ics ? ` Calendar: ${o.ics}` : ''}`);
  });

for (const [name, status] of [['done', 'done'], ['reopen', 'open']]) {
  program
    .command(name)
    .argument('<ids...>', 'task ids, e.g. T1A2B3')
    .description(name === 'done' ? 'Mark tasks done' : 'Reopen tasks')
    .action((ids) => {
      const changed = createApp({ log }).store.setTaskStatus(ids, status);
      if (!changed.length) {
        console.error('No task with those ids. See "voice-tasks tasks".');
        process.exitCode = 1;
      }
      for (const t of changed) console.log(`${t.id} ${status}: ${t.title}`);
    });
}

program
  .command('history')
  .description('Processed notes')
  .action(() => {
    const notes = createApp({ log }).store.listNotes();
    if (!notes.length) return console.log('No notes processed yet.');
    for (const n of notes) console.log(`${n.recorded_on}  ${String(n.tasks).padStart(3)} tasks  ${n.title}  [${n.engine}]\n            ${n.report}`);
  });

program
  .command('retry')
  .description('Process notes queued while AI was unavailable')
  .action(async () => {
    const app = createApp({ log });
    const pending = app.store.listPending();
    if (!pending.length) return console.log('Nothing pending.');
    const done = await app.pipeline.retryPending();
    for (const n of done) console.log(`\n${toConsole(n)}\n  Report: ${n.outputs.markdown}`);
    const left = app.store.listPending().length;
    console.log(`\n${done.length} processed, ${left} still pending.`);
    if (left) process.exitCode = 2;
  });

program
  .command('watch')
  .argument('<folder>', 'folder to watch (e.g. a synced voice memo folder)')
  .option('--interval <seconds>', 'poll interval', '10')
  .option('--out <dir>', 'output folder')
  .description('Process every new voice note dropped into a folder')
  .action((folder, o) => {
    const app = createApp({ log });
    createWatcher({ folder, pipeline: app.pipeline, store: app.store, intervalMs: Number(o.interval) * 1000, retryMs: app.config.telegram.retryMinutes * 60_000, opts: { out: o.out ? path.resolve(o.out) : undefined }, log }).start();
  });

program
  .command('telegram')
  .description('Run the Telegram bot (forward voice notes, get task lists back)')
  .action(async () => {
    const app = createApp({ log: console.log });
    await createTelegramBot({ token: app.config.telegram.token, pipeline: app.pipeline, store: app.store, config: app.config, log: console.log }).start();
  });

program
  .command('serve')
  .description('HTTP API + record/upload page')
  .option('-p, --port <port>', 'port (default PORT or 3000)')
  .action((o) => {
    const app = createApp({ log: console.log });
    const port = Number(o.port || app.config.server.port);
    createServer({ ...app, log: console.log }).listen(port, () => console.log(`Voice note API on http://localhost:${port}  (page: /, health: /health)${app.config.server.apiToken ? '' : '\nWARNING: API_TOKEN is not set, anyone who can reach this port can use it.'}`));
  });

program
  .command('doctor')
  .description('Check Node, keys, models and folders')
  .option('--ping', 'send a tiny request to every configured text model')
  .action(async (o) => {
    const app = createApp({ log });
    const c = app.config;
    const ok = (b) => (b ? 'OK  ' : '--  ');
    const major = Number(process.versions.node.split('.')[0]);
    console.log(`${ok(major >= 20)}Node ${process.versions.node} (need 20+)`);
    console.log(`${ok(process.env.GEMINI_API_KEY)}GEMINI_API_KEY (audio + text)`);
    console.log(`${ok(process.env.GROQ_API_KEY)}GROQ_API_KEY (Whisper audio fallback + text)`);
    console.log(`${ok(process.env.NVIDIA_API_KEY)}NVIDIA_API_KEY (text fallback)`);
    console.log(`${ok(process.env.OPENROUTER_API_KEY)}OPENROUTER_API_KEY (text fallback)`);
    console.log(`${ok(c.telegram.token)}TELEGRAM_BOT_TOKEN${c.telegram.token && !c.telegram.allowed.length ? ' (set TELEGRAM_ALLOWED_CHAT_IDS to keep it private)' : ''}`);
    console.log(`${ok(c.webhookUrl)}WEBHOOK_URL   ${ok(c.slackWebhookUrl)}SLACK_WEBHOOK_URL`);
    console.log(`    Owner: ${c.ownerName || '(OWNER_NAME not set)'} · output language: ${c.outputLanguage} · timezone: ${c.timezone}`);
    console.log(`    Data: ${c.dataDir}\n    Output: ${c.outDir}`);
    const show = (title, rows) => {
      console.log(`\n${title}`);
      for (const r of rows) console.log(`  ${r.state.padEnd(8)} ${r.id}${r.disabledReason ? ` (${r.disabledReason})` : ''}${r.lastError ? `  ${r.lastError}` : ''}`);
    };
    show('Audio chain (transcription):', app.transcriber.status());
    show('Text chain (task extraction):', app.analyzer.status());
    const pending = app.store.listPending().length;
    if (pending) console.log(`\n${pending} note(s) pending - run "voice-tasks retry".`);
    if (!app.transcriber.enabledCount) console.log('\nNo audio provider: set GEMINI_API_KEY or GROQ_API_KEY to transcribe recordings (transcript files still work).');
    if (o.ping) {
      console.log('\nPinging text models...');
      for (const t of app.analyzer.status().filter((s) => s.enabled)) {
        const started = Date.now();
        try {
          await app.analyzer.router.generate({ only: t.id, messages: [{ role: 'user', content: 'Reply with the word OK' }], maxTokens: 1024, timeoutMs: 20_000, totalBudgetMs: 20_000 });
          console.log(`  OK   ${t.id} ${Date.now() - started} ms`);
        } catch (err) {
          console.log(`  FAIL ${t.id} ${err.attempts?.[0]?.error || err.message}`);
        }
      }
    }
  });

program.parseAsync().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
