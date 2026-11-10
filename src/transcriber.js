import { createLLMRouter, parseChain, simulateOutage } from './ai/index.js';
import { transcriptionPrompt } from './prompts.js';
import { cleanTranscript } from './transcript.js';
import { createGeminiAudioProvider } from './transcription/gemini-audio.js';
import { createWhisperProvider } from './transcription/whisper.js';

/**
 * Audio fallback chain. Gemini understands context and speakers best, so several pinned
 * Gemini versions go first (each has its own quota and load); Groq Whisper is a fast,
 * free and independent fallback; OpenAI is used only if a key is set.
 */
export const DEFAULT_AUDIO_CHAIN = [
  'gemini:gemini-3.6-flash',
  'gemini:gemini-3.5-flash',
  'gemini:gemini-3-flash-preview',
  'gemini:gemini-flash-latest',
  'gemini:gemini-flash-lite-latest',
  'groq:whisper-large-v3-turbo',
  'groq:whisper-large-v3',
  'openai:gpt-4o-mini-transcribe',
];

export function createAudioProviders(env = process.env, { fetchImpl = fetch, inlineMaxBytes } = {}) {
  return {
    gemini: createGeminiAudioProvider({ apiKey: env.GEMINI_API_KEY, inlineMaxBytes, fetchImpl }),
    groq: createWhisperProvider({ name: 'groq', apiKey: env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1', fetchImpl }),
    openai: createWhisperProvider({ name: 'openai', apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || 'https://api.openai.com/v1', fetchImpl }),
  };
}

/**
 * @returns {{ transcribe(audio, opts): Promise<{text, model, truncated, durationSeconds, attempts}>, status(), router }}
 */
export function createTranscriber({ env = process.env, config, providers, onEvent, simulate = [], fetchImpl = fetch } = {}) {
  const all = simulateOutage(providers || createAudioProviders(env, { fetchImpl, inlineMaxBytes: config?.audio?.inlineMaxBytes }), simulate);
  const router = createLLMRouter({
    chain: parseChain(config?.audio?.chain || env.AUDIO_CHAIN || DEFAULT_AUDIO_CHAIN),
    providers: all,
    timeoutMs: config?.audio?.timeoutMs ?? 180_000,
    totalBudgetMs: config?.audio?.totalBudgetMs ?? 600_000,
    hedgeAfterMs: 0, // never pay for two transcriptions of the same file
    onEvent,
  });

  return {
    router,
    status: () => router.status(),
    get enabledCount() {
      return router.enabledCount;
    },
    /** audio: { buffer, mime, name, sha256 } */
    async transcribe(audio, { language = '', vocabulary = '', ownerName = '', only } = {}) {
      try {
        const r = await router.generate({
          messages: [{ role: 'user', content: transcriptionPrompt({ language, vocabulary, ownerName }) }],
          audio,
          language,
          vocabulary,
          only,
          parse: (t) => {
            const clean = cleanTranscript(t);
            if (clean.length < 2) throw new Error('empty transcript');
            return clean;
          },
        });
        return { text: r.data, model: r.target, truncated: Boolean(r.truncated), durationSeconds: r.durationSeconds ?? null, attempts: r.attempts };
      } finally {
        for (const p of Object.values(all)) await p.cleanup?.();
      }
    },
  };
}
