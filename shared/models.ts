import type { Model } from './types';

// Model ids persisted in conversation settings (and submitted by stale
// clients) outlive the picker catalog. Map retired ids to their successors
// so old conversations keep resolving to a routable, correctly priced model.
export const LEGACY_MODEL_IDS: Record<string, Model> = {
  'openai/gpt-5.5': 'openai/gpt-5.6-sol',
};

export function normalizeModelId(model: Model): Model {
  return LEGACY_MODEL_IDS[model] ?? model;
}

// Which upstream API a model id is routed to. The server needs this to pick a
// provider and an API key; the client needs it to know which models are usable
// with the keys that are actually configured. Kept here so the two cannot drift
// — a mismatch would show a model in the picker that 500s on first use.
export type ChatProvider = 'anthropic' | 'google' | 'openrouter';

export function providerForModel(modelId: string): ChatProvider {
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('google/')) return 'google';
  return 'openrouter';
}

// The env var each provider's credentials live in. `openrouter` is the catch-all
// route, so it covers every id that is not an `anthropic/` or `google/` one —
// including the OpenAI, xAI, Moonshot and Z.AI models in the picker.
export const PROVIDER_ENV_VAR: Record<ChatProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export const CHAT_PROVIDERS: ChatProvider[] = [
  'anthropic',
  'google',
  'openrouter',
];
