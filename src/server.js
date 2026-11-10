import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { tasksCsv, toIcs, toMarkdown } from './format.js';
import { extFromMime, kindOf, localIsoDate } from './media.js';
import { PAGE_HTML } from './page.js';
import { TranscriptionError } from './pipeline.js';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const publicNote = (note, withTranscript) => {
  const { transcript, ...rest } = note;
  return withTranscript ? note : rest;
};

/**
 * HTTP API + a phone-friendly page to record or upload a voice note.
 *  POST /api/notes          multipart "file" (audio or transcript) or JSON { text }
 *  GET  /api/notes          history
 *  GET  /api/tasks          task register (?status=open|done|all&owner=)
 *  POST /api/tasks/:id/done mark done (and /reopen)
 *  GET  /api/tasks.csv|.ics exports
 *  GET  /health             model status per provider
 */
export function createServer({ config, pipeline, store, transcriber, analyzer, log = () => {} }) {
  const app = express();
  app.disable('x-powered-by');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.floor(config.server.maxUploadMb * 1024 * 1024), files: 1 } });

  app.get('/', (_req, res) => res.type('html').send(PAGE_HTML));
  app.get('/health', (_req, res) => res.json({ ok: true, transcription: transcriber.status(), analysis: analyzer.status(), pending: store.listPending().length }));

  app.use('/api', (req, res, next) => {
    if (!config.server.apiToken) return next();
    const h = req.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
    if (token && safeEqual(token, config.server.apiToken)) return next();
    res.status(401).json({ error: 'Missing or wrong API token (Authorization: Bearer <API_TOKEN>)' });
  });

  app.post('/api/notes', upload.single('file'), express.json({ limit: '2mb' }), async (req, res) => {
    const opts = {
      date: req.body?.date || undefined,
      language: req.body?.language || undefined,
      outputLanguage: req.body?.output_language || undefined,
      context: req.body?.context || undefined,
      webhook: req.body?.webhook === 'false' || req.body?.webhook === false ? false : undefined,
    };
    let input;
    if (req.file) {
      let name = req.file.originalname || 'voice-note';
      if (!kindOf(name)) name = `${name.replace(/\.[^.]*$/, '')}${extFromMime(req.file.mimetype) || '.webm'}`;
      input = { buffer: req.file.buffer, name, mime: req.file.mimetype?.split(';')[0] || undefined, mtime: new Date() };
    } else if (typeof req.body?.text === 'string' && req.body.text.trim()) {
      input = { text: req.body.text, name: req.body.name || 'pasted-note.txt', mtime: new Date() };
    } else {
      return res.status(400).json({ error: 'Send a multipart "file" (audio or transcript) or JSON { "text": "..." }' });
    }
    if (!opts.date) opts.date = localIsoDate(new Date(), config.timezone);
    try {
      const note = await pipeline.processInput(input, opts);
      if (req.query.format === 'md') return res.type('text/markdown').send(toMarkdown(note));
      res.json(publicNote(note, req.query.transcript === '1'));
    } catch (err) {
      if (err instanceof TranscriptionError && input.buffer) {
        const id = store.addPending({ buffer: input.buffer, name: input.name, meta: { date: opts.date }, error: err.message });
        return res.status(202).json({ queued: true, pending_id: id, message: 'Transcription AI is unavailable right now. The note is saved and will be processed by `voice-tasks retry` or the bot.', error: err.message });
      }
      log(`API error: ${err.message}`);
      res.status(/unsupported|empty|invalid|over MAX/i.test(err.message) ? 400 : 500).json({ error: err.message });
    }
  });

  app.get('/api/notes', (_req, res) => res.json(store.listNotes()));
  const listTasks = (q) => store.listTasks({ status: q.status || 'open', owner: q.owner || undefined, today: localIsoDate(new Date(), config.timezone) });
  app.get('/api/tasks', (req, res) => res.json(listTasks(req.query)));
  app.get('/api/tasks.csv', (req, res) => res.type('text/csv').attachment('tasks.csv').send(tasksCsv(listTasks(req.query))));
  app.get('/api/tasks.ics', (req, res) => res.type('text/calendar').attachment('tasks.ics').send(toIcs(listTasks(req.query))));
  for (const [action, status] of [['done', 'done'], ['reopen', 'open']]) {
    app.post(`/api/tasks/:id/${action}`, (req, res) => {
      const changed = store.setTaskStatus([req.params.id], status);
      if (!changed.length) return res.status(404).json({ error: 'No task with that id' });
      res.json(changed[0]);
    });
  }

  app.use((err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${config.server.maxUploadMb} MB)` });
    res.status(400).json({ error: err.message || 'Bad request' });
  });
  return app;
}
