import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Audio/video types Gemini or Whisper accept. WhatsApp/Telegram voice notes are Opus in Ogg. */
export const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.mpga': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.webm': 'audio/webm',
  '.mov': 'video/quicktime',
};
export const TRANSCRIPT_TYPES = new Set(['.txt', '.md', '.vtt', '.srt', '.json']);

export function kindOf(name) {
  const ext = path.extname(String(name)).toLowerCase();
  if (AUDIO_TYPES[ext]) return 'audio';
  if (TRANSCRIPT_TYPES.has(ext)) return 'transcript';
  return null;
}

export function mimeOf(name, fallback = 'application/octet-stream') {
  return AUDIO_TYPES[path.extname(String(name)).toLowerCase()] || fallback;
}

/** Extension for an uploaded file that came only with a MIME type (browser recording, Telegram). */
export function extFromMime(mime = '') {
  const m = String(mime).split(';')[0].trim().toLowerCase();
  const map = { 'audio/ogg': '.ogg', 'audio/opus': '.ogg', 'audio/webm': '.webm', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'video/mp4': '.mp4', 'text/plain': '.txt' };
  return map[m] || '';
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Expand files and folders into a sorted list of supported files. */
export function collectFiles(inputs) {
  const out = [];
  for (const input of inputs) {
    const p = path.resolve(input);
    if (!fs.existsSync(p)) throw new Error(`File not found: ${input}`);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) {
        const full = path.join(p, f);
        if (fs.statSync(full).isFile() && kindOf(f) && !/\.(transcript|tasks|note)\./i.test(f)) out.push(full);
      }
    } else {
      if (!kindOf(p)) throw new Error(`Unsupported file type: ${input} (audio: ${Object.keys(AUDIO_TYPES).join(' ')}; text: .txt .md .vtt .srt .json)`);
      out.push(p);
    }
  }
  return [...new Set(out)];
}

/**
 * The day the note was recorded, used to resolve "tomorrow" / "next Friday".
 * Order: explicit date > date in the file name > file time > today.
 * Understands 2026-11-10, 20261110 (WhatsApp "PTT-20261110-WA0001"), 10.11.2026.
 */
export function noteDateFor({ explicit, name = '', mtime, timezone } = {}) {
  if (explicit) {
    if (!isIsoDate(explicit)) throw new Error(`Invalid --date "${explicit}" (use YYYY-MM-DD)`);
    return explicit;
  }
  const base = path.basename(String(name));
  const patterns = [
    /(20\d{2})[-_.](\d{2})[-_.](\d{2})/,
    /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/,
    /(?:^|\D)(\d{2})[-_.](\d{2})[-_.](20\d{2})(?:\D|$)/,
  ];
  for (const [i, re] of patterns.entries()) {
    const m = base.match(re);
    if (!m) continue;
    const iso = i === 2 ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
    if (isIsoDate(iso)) return iso;
  }
  return localIsoDate(mtime || new Date(), timezone);
}

export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function localIsoDate(date = new Date(), timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Duration of a PCM WAV file in seconds (other formats: null; Whisper reports its own). */
export function wavDurationSeconds(buffer) {
  try {
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
    let offset = 12;
    let byteRate = 0;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
      if (id === 'data' && byteRate) return Math.round((Math.min(size, buffer.length - offset - 8) / byteRate) * 10) / 10;
      offset += 8 + size + (size % 2);
    }
  } catch {
    /* not a readable wav */
  }
  return null;
}

export function slugify(s, max = 50) {
  return (
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'voice-note'
  );
}
