import {
  CHAT_PROVIDERS,
  PROVIDER_ENV_VAR,
  type ChatProvider,
} from '@shared/models';
import { json, methodNotAllowed, preflight } from './api';
import { env } from './env';

export type AvailableProvidersResponse = {
  providers: ChatProvider[];
};

// Which chat providers this deployment can actually reach. A provider counts as
// available only if its API key env var is set to a non-empty value — the same
// vars buildChatModel() reads via requiredEnv(), so anything reported here is
// guaranteed to construct.
//
// Only the provider names are returned, never the keys or even their length:
// this is an unauthenticated endpoint, and "which providers are configured" is
// already inferable from the picker UI.
export function availableProviders(): ChatProvider[] {
  return CHAT_PROVIDERS.filter(
    (provider) => env(PROVIDER_ENV_VAR[provider]).trim().length > 0,
  );
}

export function handleAvailableModelsRequest(request: Request): Response {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return methodNotAllowed();

  return json({ providers: availableProviders() });
}
