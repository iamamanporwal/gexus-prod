export function env(name: string): string {
  return process.env[name] ?? '';
}

export function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function webhookBaseUrl(requestUrl: string): string {
  const configuredUrl = env('WEBHOOK_BASE_URL');
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
  return new URL(requestUrl).origin;
}

/**
 * The path prefix the app is mounted under, normalised to either '' or
 * '/prefix' (never a trailing slash).
 *
 * Mirrors `appBase` in vite.config.ts, which serves the app at '/'. Upstream
 * mounted it under '/cadam' and the fal webhook URLs were written as literal
 * '/cadam/api/...' strings — so when the app moved to the domain root those
 * URLs kept pointing at a path that 404s. fal's callback then landed nowhere,
 * every mesh sat at 'pending' forever, and nothing in the app reported an
 * error because the failure happens entirely on fal's side of the call.
 *
 * Reading it from env keeps the two in sync through configuration rather than
 * through someone remembering to grep for the literal.
 */
export function appBasePath(): string {
  const configured = env('APP_BASE_PATH').trim();
  if (!configured || configured === '/') return '';
  const withLeadingSlash = configured.startsWith('/')
    ? configured
    : `/${configured}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

/** Absolute URL of one of the app's own API routes. */
export function apiEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${appBasePath()}/api/${path.replace(/^\//, '')}`;
}

/**
 * The callback URL handed to fal when a mesh/preview job is queued.
 *
 * `id` identifies the row to complete; `mode=preview` routes the result to the
 * `previews` table instead of `meshes`.
 */
export function falWebhookUrl(
  baseUrl: string,
  id: string,
  mode?: 'preview',
): string {
  const url = `${apiEndpoint(baseUrl, 'fal-webhook')}?id=${encodeURIComponent(id)}`;
  return mode ? `${url}&mode=${mode}` : url;
}
