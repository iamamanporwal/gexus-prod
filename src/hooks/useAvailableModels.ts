import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import { providerForModel, type ChatProvider } from '@shared/models';
import type { Model } from '@shared/types';
import { apiJson } from '@/services/api';
import { PARAMETRIC_MODELS } from '@/lib/utils';
import type { ModelConfig } from '@/types/misc';

const availableProvidersSchema = z.object({
  providers: z.array(z.enum(['anthropic', 'google', 'openrouter'])),
});

// Which parametric model the picker starts on when nothing else is chosen.
// Routed through OpenRouter, so it needs OPENROUTER_API_KEY — if that is unset
// the hooks below fall back to the first model that is actually reachable.
export const DEFAULT_PARAMETRIC_MODEL: Model = 'openai/gpt-5.6-sol';

/**
 * The providers whose API keys are set on the server.
 *
 * Cached for the session: the answer is derived from server env vars, which
 * cannot change without a restart. `retry: false` because a failure here should
 * degrade quietly rather than spin — see the fallback in
 * useAvailableParametricModels.
 */
function useAvailableProviders() {
  return useQuery({
    queryKey: ['available-providers'],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: () =>
      apiJson('available-models', {}, availableProvidersSchema).then(
        (res) => res.providers,
      ),
  });
}

/**
 * PARAMETRIC_MODELS narrowed to the models this deployment can actually run.
 *
 * While the query is in flight — and if it fails outright — the full catalog is
 * returned rather than an empty list, so the picker never flashes blank and a
 * server hiccup cannot lock the user out of choosing a model. The window is a
 * single request on app boot, and `isLoading` is exposed so callers that must
 * not act early (e.g. correcting an unusable default) can wait.
 */
export function useAvailableParametricModels(): {
  models: ModelConfig[];
  providers: ChatProvider[] | undefined;
  isLoading: boolean;
} {
  const { data: providers, isLoading } = useAvailableProviders();

  const models = useMemo(() => {
    if (!providers) return PARAMETRIC_MODELS;
    const filtered = PARAMETRIC_MODELS.filter((model) =>
      providers.includes(providerForModel(model.id)),
    );
    // No key for anything is a misconfiguration, not a reason to render an
    // empty dropdown the user cannot escape. Show the catalog and let the
    // server's own error surface explain what is missing.
    return filtered.length > 0 ? filtered : PARAMETRIC_MODELS;
  }, [providers]);

  return { models, providers, isLoading };
}

/**
 * Picks a usable parametric model id, preferring `preferred` when it is
 * available. Returns the first available model otherwise, so a conversation
 * saved against a model whose key has since been removed still opens.
 */
export function resolveUsableModel(
  preferred: Model,
  models: ModelConfig[],
): Model {
  if (models.some((model) => model.id === preferred)) return preferred;
  return models[0]?.id ?? preferred;
}
