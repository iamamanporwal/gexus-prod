import { LOCAL_USER, type LocalUser } from '@shared/localUser';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// Resolves the caller's identity. Authentication has been removed, so this no
// longer inspects the request — every request is the one local user.
//
// Kept as a function (rather than inlining LOCAL_USER at each call site) so the
// handlers keep a single, obvious place where identity enters the server, and
// so `isUnauthorizedError` stays meaningful if a caller ever reintroduces one.
export function requireUser(_request: Request): LocalUser {
  return LOCAL_USER;
}
