import fs from 'node:fs';
import path from 'node:path';
import { sortTasks } from './analysis.js';
import { daysBetween } from './dates.js';
import { localIsoDate } from './media.js';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Everything kept on disk under DATA_DIR:
 *  cache/transcripts/<sha>.json   transcript per audio file (+ language)
 *  cache/analysis/<key>.json      AI analysis per transcript + options
 *  notes.json                     history of processed notes
 *  tasks.json                     task register across all notes (open / done)
 *  pending/                       audio waiting for AI to come back
 */
export function createStore(dataDir) {
  const p = (...parts) => path.join(dataDir, ...parts);

  return {
    dataDir,
    getCache(kind, key) {
      return readJson(p('cache', kind, `${key}.json`), null);
    },
    setCache(kind, key, value) {
      writeJson(p('cache', kind, `${key}.json`), value);
    },

    addNote(note) {
      const notes = readJson(p('notes.json'), []);
      const entry = {
        id: note.id,
        title: note.title,
        recorded_on: note.recorded_on,
        processed_at: note.processed_at,
        source: note.source.file,
        tasks: note.stats.tasks,
        engine: note.analysis_engine,
        report: note.outputs?.markdown || '',
      };
      const i = notes.findIndex((n) => n.id === note.id);
      if (i >= 0) notes[i] = entry;
      else notes.push(entry);
      writeJson(p('notes.json'), notes);
    },
    listNotes() {
      return readJson(p('notes.json'), []);
    },

    /** Merge a note's tasks into the register; existing tasks keep their status. */
    registerTasks(note) {
      const reg = readJson(p('tasks.json'), []);
      const byId = new Map(reg.map((t) => [t.id, t]));
      let added = 0;
      for (const t of note.tasks) {
        const prev = byId.get(t.id);
        const row = { ...t, note_id: note.id, note_title: note.title, recorded_on: note.recorded_on, status: prev?.status || 'open', done_at: prev?.done_at || null };
        if (!prev) added++;
        byId.set(t.id, row);
      }
      writeJson(p('tasks.json'), [...byId.values()]);
      return added;
    },
    listTasks({ status = 'open', owner, overdue = false, dueWithin, today = localIsoDate() } = {}) {
      let rows = readJson(p('tasks.json'), []);
      if (status !== 'all') rows = rows.filter((t) => t.status === status);
      if (owner) {
        const o = owner.toLowerCase();
        rows = rows.filter((t) => t.owner.toLowerCase() === o || (o === 'me' && t.owner_type === 'self') || t.owner.toLowerCase().split(' ')[0] === o);
      }
      if (overdue) rows = rows.filter((t) => t.due_date && t.due_date < today);
      if (dueWithin !== undefined) rows = rows.filter((t) => t.due_date && daysBetween(today, t.due_date) <= dueWithin);
      return sortTasks(rows);
    },
    setTaskStatus(ids, status) {
      const reg = readJson(p('tasks.json'), []);
      const want = new Set(ids.map((s) => s.toUpperCase()));
      const changed = [];
      for (const t of reg) {
        if (want.has(t.id.toUpperCase())) {
          t.status = status;
          t.done_at = status === 'done' ? new Date().toISOString() : null;
          changed.push(t);
        }
      }
      writeJson(p('tasks.json'), reg);
      return changed;
    },

    /** Keep audio that could not be transcribed so `retry` (or the bot) can try again. */
    addPending({ buffer, name, sourcePath, meta = {}, error = '' }) {
      fs.mkdirSync(p('pending'), { recursive: true });
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let file = sourcePath || '';
      if (buffer) {
        file = p('pending', `${id}-${path.basename(name || 'voice-note.ogg')}`);
        fs.writeFileSync(file, buffer);
      }
      writeJson(p('pending', `${id}.json`), { id, file, name, meta, error, queued_at: new Date().toISOString(), tries: 1 });
      return id;
    },
    listPending() {
      if (!fs.existsSync(p('pending'))) return [];
      return fs
        .readdirSync(p('pending'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson(p('pending', f), null))
        .filter(Boolean);
    },
    updatePending(item) {
      writeJson(p('pending', `${item.id}.json`), item);
    },
    removePending(item) {
      fs.rmSync(p('pending', `${item.id}.json`), { force: true });
      if (item.file && item.file.startsWith(p('pending'))) fs.rmSync(item.file, { force: true });
    },

    /** Files already handled by `watch`, keyed by content hash. */
    seen() {
      return new Set(readJson(p('watch-seen.json'), []));
    },
    markSeen(hash) {
      const s = new Set(readJson(p('watch-seen.json'), []));
      s.add(hash);
      writeJson(p('watch-seen.json'), [...s]);
    },
  };
}
