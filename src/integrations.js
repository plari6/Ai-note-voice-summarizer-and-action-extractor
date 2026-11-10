import crypto from 'node:crypto';
import { toSlack } from './format.js';

async function postJson(url, body, { headers = {}, fetchImpl = fetch, timeoutMs = 15_000, retries = 2, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const payload = JSON.stringify(body);
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return { ok: true, status: res.status };
      const text = await res.text().catch(() => '');
      lastErr = new Error(`HTTP ${res.status} ${text.slice(0, 160)}`.trim());
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = err;
    }
    if (i < retries) await sleep(1000 * 2 ** i);
  }
  throw lastErr;
}

/** Payload for Zapier / Make / n8n -> Asana, ClickUp, Monday, Todoist, Jira, Notion, HubSpot... */
export function webhookPayload(note) {
  const { transcript, ...rest } = note;
  return { event: 'voice_note.processed', sent_at: new Date().toISOString(), note: { ...rest, transcript_excerpt: String(transcript || '').slice(0, 2000) }, tasks: note.tasks.map((t) => ({ ...t, note_id: note.id, note_title: note.title, recorded_on: note.recorded_on })) };
}

export function sign(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export async function sendWebhook(url, note, { secret = '', fetchImpl, sleep } = {}) {
  const body = webhookPayload(note);
  const headers = { 'user-agent': 'voice-tasks/1.0', 'x-voice-tasks-event': body.event };
  if (secret) headers['x-voice-tasks-signature'] = sign(JSON.stringify(body), secret);
  return postJson(url, body, { headers, fetchImpl, sleep });
}

export async function sendSlack(url, note, { fetchImpl, sleep } = {}) {
  return postJson(url, toSlack(note), { fetchImpl, sleep });
}
