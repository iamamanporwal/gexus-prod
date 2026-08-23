import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHAT_PROVIDERS,
  PROVIDER_ENV_VAR,
  providerForModel,
  normalizeModelId,
} from './models.ts';

describe('providerForModel', () => {
  it('routes anthropic/ and google/ prefixes to their native providers', () => {
    assert.equal(providerForModel('anthropic/claude-fable-5'), 'anthropic');
    assert.equal(providerForModel('anthropic/claude-opus-4.8'), 'anthropic');
    assert.equal(providerForModel('google/gemini-3.1-pro-preview'), 'google');
    assert.equal(providerForModel('google/gemini-3.6-flash'), 'google');
  });

  it('routes everything else through OpenRouter', () => {
    assert.equal(providerForModel('openai/gpt-5.6-sol'), 'openrouter');
    assert.equal(providerForModel('x-ai/grok-4.5'), 'openrouter');
    assert.equal(providerForModel('moonshotai/kimi-k3'), 'openrouter');
    assert.equal(providerForModel('z-ai/glm-5.2'), 'openrouter');
  });

  it('falls back to OpenRouter for unknown and malformed ids', () => {
    // An id from a future catalog must still resolve to something routable
    // rather than throwing at the picker boundary.
    assert.equal(providerForModel('some-new-vendor/model-1'), 'openrouter');
    assert.equal(providerForModel(''), 'openrouter');
  });

  it('does not match a provider name appearing mid-id', () => {
    // Guards against a substring check creeping back in: only the prefix counts.
    assert.equal(providerForModel('mirror/anthropic-clone'), 'openrouter');
    assert.equal(providerForModel('proxy/google-gemini'), 'openrouter');
  });
});

describe('provider env var mapping', () => {
  it('covers every provider exactly once', () => {
    const keys = Object.keys(PROVIDER_ENV_VAR).sort();
    assert.deepEqual(keys, [...CHAT_PROVIDERS].sort());
  });

  it('names the vars the server actually reads', () => {
    assert.equal(PROVIDER_ENV_VAR.anthropic, 'ANTHROPIC_API_KEY');
    assert.equal(PROVIDER_ENV_VAR.google, 'GOOGLE_API_KEY');
    assert.equal(PROVIDER_ENV_VAR.openrouter, 'OPENROUTER_API_KEY');
  });
});

describe('legacy model ids', () => {
  it('maps retired ids to a successor that still routes', () => {
    const mapped = normalizeModelId('openai/gpt-5.5');
    assert.equal(mapped, 'openai/gpt-5.6-sol');
    assert.equal(providerForModel(mapped), 'openrouter');
  });

  it('leaves current ids untouched', () => {
    assert.equal(
      normalizeModelId('anthropic/claude-sonnet-5'),
      'anthropic/claude-sonnet-5',
    );
  });
});
