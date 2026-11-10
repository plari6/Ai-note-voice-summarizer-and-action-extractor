import { createAnalyzer } from './analyzer.js';
import { getConfig } from './config.js';
import { createPipeline } from './pipeline.js';
import { createStore } from './store.js';
import { createTranscriber } from './transcriber.js';

export { createAnalyzer, getConfig, createPipeline, createStore, createTranscriber };
export { normalizeAnalysis, buildDelegations, noteStats } from './analysis.js';
export { resolveDuePhrase } from './dates.js';
export { extractWithRules } from './rules.js';
export { toMarkdown, toIcs, tasksCsv, toSlack, toTelegram } from './format.js';
export { createServer } from './server.js';
export { createTelegramBot } from './telegram.js';
export { createWatcher } from './watch.js';
export { TranscriptionError } from './pipeline.js';

/** Wire everything from environment variables (what the CLI does). */
export function createApp({ env = process.env, log = () => {}, simulate = [], fetchImpl = fetch, transcriber, analyzer } = {}) {
  const config = getConfig(env);
  const store = createStore(config.dataDir);
  const onEvent = (e) => {
    if (e.type === 'failure') log(`[ai] ${e.target} failed (${e.kind}${e.status ? ` ${e.status}` : ''}) -> next model`);
    if (e.type === 'hedge') log(`[ai] slow answer, also asking ${e.targets.at(-1)}`);
  };
  const t = transcriber || createTranscriber({ env, config, onEvent, simulate, fetchImpl });
  const a = analyzer || createAnalyzer({ env, config, onEvent, simulate, fetchImpl });
  const pipeline = createPipeline({ config, store, transcriber: t, analyzer: a, fetchImpl, log });
  return { config, store, transcriber: t, analyzer: a, pipeline };
}
