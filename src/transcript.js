/**
 * Turn any transcript format into plain "[mm:ss] Speaker: text" lines.
 * Accepts: plain text / Markdown, WebVTT, SRT, Whisper / Otter-style JSON.
 */

const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
export const formatTimestamp = fmt;

function cueSeconds(t) {
  const m = String(t).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseCues(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const arrow = line.match(/^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!arrow) {
      i++;
      continue;
    }
    const start = cueSeconds(arrow[1]);
    const body = [];
    i++;
    while (i < lines.length && lines[i].trim() !== '') body.push(lines[i++]);
    let content = body.join(' ').replace(/<\/?[^>]+>/g, '').trim();
    // WebVTT voice tags: <v Sarah>Hello
    const voice = body.join(' ').match(/<v\s+([^>]+)>/);
    if (voice && !content.includes(':')) content = `${voice[1].trim()}: ${content}`;
    if (content) out.push({ start, text: content });
  }
  // Merge consecutive cues from the same speaker so lines read as sentences.
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    const speaker = c.text.match(/^([^:]{1,40}):\s/)?.[1];
    if (last && speaker === last.speaker && c.start - last.start < 60) last.text += ` ${speaker ? c.text.slice(speaker.length + 1).trim() : c.text}`;
    else merged.push({ start: c.start, speaker, text: c.text });
  }
  return merged.map((c) => `[${fmt(c.start)}] ${c.text}`).join('\n');
}

function parseJsonTranscript(text) {
  const data = JSON.parse(text);
  if (typeof data === 'string') return data;
  if (typeof data.transcript === 'string') return data.transcript;
  const segments = data.segments || data.utterances || data.results || (Array.isArray(data) ? data : null);
  if (Array.isArray(segments)) {
    return segments
      .map((s) => {
        const start = s.start ?? s.start_time ?? (s.startMs ?? s.start_ms ?? 0) / 1000;
        const speaker = s.speaker || s.speaker_name || '';
        const t = String(s.text ?? s.transcript ?? '').trim();
        return t ? `[${fmt(Number(start) || 0)}] ${speaker ? `${speaker}: ` : ''}${t}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof data.text === 'string') return data.text;
  throw new Error('JSON transcript not recognised (expected "text", "transcript" or "segments")');
}

export function parseTranscript(text, name = '') {
  const raw = String(text).replace(/^﻿/, '');
  const lower = name.toLowerCase();
  let out;
  if (lower.endsWith('.json')) out = parseJsonTranscript(raw);
  else if (lower.endsWith('.vtt') || lower.endsWith('.srt') || /^\s*(WEBVTT|1\s*\n\s*\d{2}:\d{2})/.test(raw)) out = parseCues(raw);
  else out = raw;
  return cleanTranscript(out);
}

export function cleanTranscript(text) {
  return String(text)
    .replace(/^```[a-z]*\n?|\n?```$/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Seconds of the last timestamp, a rough length of the note. */
export function transcriptDuration(text) {
  const all = [...String(text).matchAll(/\[(\d+:)?(\d{1,2}):(\d{2})\]/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return Number((m[1] || '0:').slice(0, -1)) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export const wordCount = (text) => (String(text).match(/[\p{L}\p{N}']+/gu) || []).length;
