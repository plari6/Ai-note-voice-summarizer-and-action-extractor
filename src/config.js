import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** .env in the current folder first, then the project's own .env (never overrides real env vars). */
export function loadEnv() {
  if (process.env.VOICE_TASKS_SKIP_DOTENV === '1') return;
  for (const file of [path.resolve('.env'), path.join(PROJECT_ROOT, '.env')]) {
    if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
  }
}

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function getConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(PROJECT_ROOT, 'data'));
  return {
    dataDir,
    outDir: path.resolve(env.OUTPUT_DIR || path.join(PROJECT_ROOT, 'output')),
    // Who is speaking in the notes ("Me" in task lists) and what they do - improves owners and wording.
    ownerName: env.OWNER_NAME || '',
    context: env.NOTE_CONTEXT || '',
    // Names and terms the transcriber should spell correctly (people, clients, products).
    vocabulary: env.VOCABULARY || '',
    // "auto" = answer in the language of the voice note.
    outputLanguage: env.OUTPUT_LANGUAGE || 'English',
    noteLanguage: env.NOTE_LANGUAGE || '',
    timezone: env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    audio: {
      chain: env.AUDIO_CHAIN || '',
      timeoutMs: num(env.AUDIO_TIMEOUT_MS, 180_000),
      totalBudgetMs: num(env.AUDIO_TOTAL_BUDGET_MS, 600_000),
      inlineMaxBytes: num(env.AUDIO_INLINE_MAX_MB, 14) * 1024 * 1024,
      maxBytes: num(env.MAX_AUDIO_MB, 200) * 1024 * 1024,
    },
    // Analysis is a batch job, so the text chain gets more time than a chat bot would.
    aiEnv: {
      ...env,
      AI_TIMEOUT_MS: env.AI_TIMEOUT_MS || '45000',
      AI_TOTAL_BUDGET_MS: env.AI_TOTAL_BUDGET_MS || '150000',
      AI_HEDGE_MS: env.AI_HEDGE_MS ?? '30000',
    },
    webhookUrl: env.WEBHOOK_URL || '',
    webhookSecret: env.WEBHOOK_SECRET || '',
    slackWebhookUrl: env.SLACK_WEBHOOK_URL || '',
    telegram: {
      token: env.TELEGRAM_BOT_TOKEN || '',
      allowed: list(env.TELEGRAM_ALLOWED_CHAT_IDS),
      retryMinutes: num(env.PENDING_RETRY_MINUTES, 10),
    },
    server: {
      port: num(env.PORT, 3000),
      apiToken: env.API_TOKEN || '',
      maxUploadMb: num(env.MAX_UPLOAD_MB, 100),
    },
  };
}
