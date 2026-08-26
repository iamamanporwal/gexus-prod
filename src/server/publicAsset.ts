// Serves the stored assets of a PUBLICLY SHARED conversation to people who do
// not own it.
//
// Why this exists at all: Firestore rules can consult a conversation's
// `privacy` field (see `parentIsPublic` in firestore.rules), so a shared link's
// text, meshes and image ROWS are already world-readable. Cloud Storage rules
// cannot — they have no way to read a Firestore document — so the actual GLB
// and PNG BYTES stay owner-only. The result was a share page that rendered the
// conversation and then showed an empty viewer, which is the least useful half
// to be able to share.
//
// The alternatives were worse. Copying assets into a `public/` prefix on share
// duplicates every model and leaves stale copies behind when a link is revoked;
// opening the Storage rules to any signed-in reader makes every private model
// readable by every guest. Proxying through the server keeps one copy, and
// revocation is immediate: flip `privacy` back to 'private' and the next
// request 404s.
//
// Access is derived entirely from the conversation document. There is no
// caller identity involved and none is needed — that is the point of a public
// link — but it does mean this handler must be strict about what it will serve:
// only paths under the owning user's folder for that exact conversation.

import { Readable } from 'node:stream';
import { corsHeaders } from './api';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import { adminBucket } from './firestoreAdmin';
import { bucketPath } from '@shared/firestore/storage';
import { logError } from './serverLog';

/** The three buckets a shared conversation renders from. */
const PUBLIC_KINDS = new Set(['meshes', 'previews', 'images']);

const CONTENT_TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/octet-stream',
  stl: 'model/stl',
  obj: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function textResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
}

export async function handlePublicAssetRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  const conversationId = params.get('conversation') ?? '';
  const kind = params.get('kind') ?? '';
  const file = params.get('file') ?? '';

  if (!conversationId || !kind || !file) {
    return textResponse('Missing conversation, kind or file', 400);
  }

  if (!PUBLIC_KINDS.has(kind)) {
    return textResponse('Unknown asset kind', 400);
  }

  // `file` is interpolated into a storage path, so it must be a single path
  // segment. Without this, `file=../../someone-else/private/model.glb` would
  // walk out of the conversation's folder and serve anything in the bucket.
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(file) || file.includes('..')) {
    return textResponse('Invalid file name', 400);
  }

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) {
    return textResponse('Invalid conversation id', 400);
  }

  try {
    const db = getServiceRoleSupabaseClient();
    const { data: conversation } = await db
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .limit(1)
      .maybeSingle();

    // A private conversation and a missing one answer identically on purpose:
    // a distinct "exists but is private" reply would turn this endpoint into a
    // way to test whether a given id is a real conversation.
    if (!conversation || conversation.privacy !== 'public') {
      return textResponse('Not found', 404);
    }

    const ownerId = String(conversation.user_id ?? '');
    if (!ownerId) return textResponse('Not found', 404);

    // The path is assembled from the CONVERSATION's own owner and id — never
    // from anything the caller sent — so a public link can only ever reach the
    // assets of the conversation it names.
    const objectPath = bucketPath(kind, `${ownerId}/${conversationId}/${file}`);
    const object = adminBucket().file(objectPath);

    const [exists] = await object.exists();
    if (!exists) return textResponse('Not found', 404);

    const [metadata] = await object.getMetadata();
    const extension = file.split('.').pop()?.toLowerCase() ?? '';
    const contentType =
      metadata.contentType ||
      CONTENT_TYPES[extension] ||
      'application/octet-stream';

    // Streamed rather than buffered: a textured GLB runs to tens of megabytes,
    // and holding one in the function's heap per concurrent viewer is how a
    // popular share link takes the function down.
    const body = Readable.toWeb(
      object.createReadStream(),
    ) as unknown as ReadableStream;

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        ...(metadata.size ? { 'Content-Length': String(metadata.size) } : {}),
        // Short, not immutable. The bytes at a path never change, but the
        // PERMISSION to read them does: unsharing must actually take effect.
        // Five minutes keeps a popular link cheap without making revocation
        // feel broken.
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    logError(error, {
      functionName: 'public-asset',
      statusCode: 500,
      userId: '',
      conversationId,
      additionalContext: { kind, file },
    });
    return textResponse('Failed to load asset', 500);
  }
}
