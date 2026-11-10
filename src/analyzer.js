import { createRouterFromEnv } from './ai/index.js';
import { analysisPrompt, analysisSystem } from './prompts.js';
import { extractWithRules } from './rules.js';

export function parseAnalysisJson(text) {
  const s = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in answer');
  const data = JSON.parse(s.slice(start, end + 1));
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('JSON has no "tasks" array');
  return data;
}

/**
 * Text analysis over the multi-model fallback chain. If every model fails, the keyword
 * extractor answers instead, so a note never comes back empty.
 */
export function createAnalyzer({ env = process.env, config, router, onEvent, simulate = [], fetchImpl = fetch } = {}) {
  const ai = router || createRouterFromEnv(config?.aiEnv || env, { onEvent, simulate, fetchImpl });
  return {
    router: ai,
    status: () => ai.status(),
    async analyze(transcript, { noteDate, ownerName = '', context = '', outputLanguage = 'English', title = '', noAi = false } = {}) {
      if (!noAi && ai.enabledCount) {
        try {
          const r = await ai.generate({
            system: analysisSystem({ ownerName, context, outputLanguage }),
            messages: [{ role: 'user', content: analysisPrompt(transcript, { noteDate, title }) }],
            json: true,
            temperature: 0.2,
            maxTokens: 12_000,
            parse: parseAnalysisJson,
          });
          return { data: r.data, engine: 'ai', model: r.target, attempts: r.attempts, warnings: [] };
        } catch (err) {
          const why = err.attempts?.length ? err.attempts.map((a) => `${a.target}: ${a.kind}`).join(', ') : err.message;
          return { data: extractWithRules(transcript, { noteDate }), engine: 'rules', model: 'rules', attempts: err.attempts || [], warnings: [`AI analysis failed (${why}); used the keyword extractor. Re-run with --refresh when AI is back.`] };
        }
      }
      const reason = noAi ? 'AI disabled (--no-ai)' : 'no AI key configured';
      return { data: extractWithRules(transcript, { noteDate }), engine: 'rules', model: 'rules', attempts: [], warnings: [`${reason}; used the keyword extractor.`] };
    },
  };
}
