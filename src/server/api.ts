import { getAuth } from 'firebase-admin/auth';
import { adminApp } from './firestoreAdmin';

// `*` lets any site on the internet call these endpoints from a visitor's
// browser — including the chat endpoint, which spends real money on this
// deployment's API keys. Set ALLOWED_ORIGIN to the deployment's own origin
// (e.g. https://gexus.example.com) to close that off.
//
// Unset falls back to `*` so local dev and preview URLs keep working without
// per-environment config. That default is only safe because a local stack has
// nothing worth stealing; a public deployment must set it.
const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim() || '*';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // A pinned origin makes the response origin-specific, so shared caches must
  // key on Origin. Omitted entirely under `*`, where every response is alike.
  ...(allowedOrigin === '*' ? {} : { Vary: 'Origin' }),
};

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

export function preflight() {
  return new Response('ok', { headers: corsHeaders });
}

export function methodNotAllowed() {
  return json({ error: 'method_not_allowed' }, 405);
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof Error && error.message === 'Unauthorized';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Resolves and VERIFIES the caller's identity.
//
// This is the single place identity enters the server. Previously it ignored the
// request and returned a hard-coded constant, which meant every request was the
// same user and anyone could act as them. Now it verifies the Firebase ID token
// the client attaches (see services/api.ts), so `user.id` is a uid Google has
// cryptographically vouched for.
//
// Why this matters more here than it looks: the server holds admin credentials,
// which bypass Firestore Security Rules entirely. The rules protect the client
// path only. If this function returned an unverified id, every handler that
// scopes its queries by `user.id` would happily read and write another guest's
// data. The rules cannot save us on this side — this check is the whole defence.
export async function requireUser(request: Request): Promise<AuthedUser> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) throw new Error('Unauthorized');

  try {
    // checkRevoked: false — an anonymous session has no sign-out flow, and the
    // extra lookup would cost a round trip on every request.
    const decoded = await getAuth(adminApp()).verifyIdToken(token);
    return { id: decoded.uid };
  } catch {
    // Deliberately opaque: a malformed, expired and forged token are all just
    // "Unauthorized" to the caller. isUnauthorizedError() maps this to a 401.
    throw new Error('Unauthorized');
  }
}

export type AuthedUser = { id: string };
