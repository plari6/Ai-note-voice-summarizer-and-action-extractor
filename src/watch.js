import fs from 'node:fs';
import path from 'node:path';
import { kindOf, sha256 } from './media.js';
import { TranscriptionError } from './pipeline.js';

/**
 * Watch a folder (iCloud/Dropbox/OneDrive voice memo sync, a shared drive, an email-attachment
 * drop) and process every new voice note once. Polling is used instead of fs.watch because it
 * works reliably on network and cloud-synced folders. A file is processed only after its size
 * stopped changing between two polls (still uploading otherwise).
 */
export function createWatcher({ folder, pipeline, store, intervalMs = 10_000, retryMs = 10 * 60_000, opts = {}, log = console.log, onNote = async () => {} }) {
  const dir = path.resolve(folder);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Folder not found: ${folder}`);
  const sizes = new Map();
  let timer = null;
  let busy = false;
  let lastRetry = Date.now();

  async function scan() {
    if (busy) return;
    busy = true;
    try {
      const seen = store.seen();
      for (const f of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, f);
        if (!kindOf(f) || f.startsWith('.') || /\.(transcript|tasks)\./i.test(f)) continue;
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const prev = sizes.get(full);
        sizes.set(full, stat.size);
        if (prev !== stat.size || stat.size === 0) continue; // new or still being written
        const hash = sha256(fs.readFileSync(full));
        if (seen.has(hash)) continue;
        try {
          log(`New voice note: ${f}`);
          const note = await pipeline.processInput({ path: full }, opts);
          log(`  -> ${note.stats.tasks} tasks, ${note.outputs.markdown || ''}`);
          await onNote(note);
        } catch (err) {
          if (err instanceof TranscriptionError) {
            store.addPending({ sourcePath: full, name: f, meta: opts, error: err.message });
            log(`  AI unavailable, queued for retry: ${err.message}`);
          } else log(`  Failed: ${err.message}`);
        }
        store.markSeen(hash);
      }
      if (Date.now() - lastRetry > retryMs && store.listPending().length) {
        lastRetry = Date.now();
        await pipeline.retryPending(opts, onNote);
      }
    } finally {
      busy = false;
    }
  }

  return {
    scan,
    start() {
      log(`Watching ${dir} every ${Math.round(intervalMs / 1000)} s (Ctrl+C to stop)`);
      scan();
      timer = setInterval(scan, intervalMs);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
