import { guestIdToken } from '@/lib/db';
import { z } from 'zod';

export function apiUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${basePath}/api/${path}`;
}

/**
 * Authorization header for the guest's current session, for callers that build
 * their own fetch — the AI SDK chat transports in ChatSession and PromptView.
 *
 * Returns an empty object rather than throwing when there is no session, so a
 * request made before the boot gate resolves gets a clean 401 from the server
 * instead of an unhandled rejection in the transport.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await guestIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiJson(
  path: string,
  init?: RequestInit,
): Promise<unknown>;
export async function apiJson<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T>;
export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  schema?: z.ZodType<T>,
): Promise<T | unknown> {
  // The anonymous session's ID token. requireUser() in src/server/api.ts
  // verifies it and derives the caller's uid from it — without this header
  // every request is a 401, since the server no longer assumes an identity.
  const url = apiUrl(path);
  const token = await guestIdToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  });
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    const preview = (await response.text()).slice(0, 160);
    throw new Error(`Unexpected API response from ${url}: ${preview}`);
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    const errorValue =
      typeof data === 'object' && data !== null
        ? Reflect.get(data, 'error')
        : undefined;
    throw new Error(
      typeof errorValue === 'string' ? errorValue : response.statusText,
    );
  }
  return schema ? schema.parse(data) : data;
}
