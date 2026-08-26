import { supabase, guestUserId } from '@/lib/db';
import { apiUrl } from '@/services/api';

/**
 * Downloads a stored asset belonging to a conversation, from either side of a
 * share link.
 *
 * The owner reads Cloud Storage directly with their own credentials, which is
 * the fast path and the only one that works for a private conversation.
 *
 * A viewer of a shared link cannot: Storage rules authorise on the `<uid>/`
 * path prefix and have no way to consult the conversation's `privacy` field,
 * so a non-owner is denied even when the conversation is public. They go
 * through `/api/public-asset`, which checks `privacy` server-side and streams
 * the bytes back. See src/server/publicAsset.ts.
 *
 * Choosing by ownership rather than trying storage first and falling back
 * keeps the shared path at one request instead of a guaranteed 403 followed by
 * a retry.
 */
export type AssetKind = 'meshes' | 'previews' | 'images';

export function isConversationOwner(ownerId: string | null | undefined) {
  if (!ownerId) return false;
  try {
    return guestUserId() === ownerId;
  } catch {
    // guestUserId throws before the session resolves. Treating that as "not
    // the owner" is the safe default: the public endpoint works for the owner
    // of a public conversation too, so the worst case is a slower read, never
    // a failed one.
    return false;
  }
}

export function publicAssetUrl({
  conversationId,
  kind,
  file,
}: {
  conversationId: string;
  kind: AssetKind;
  file: string;
}): string {
  const params = new URLSearchParams({
    conversation: conversationId,
    kind,
    file,
  });
  return `${apiUrl('public-asset')}?${params.toString()}`;
}

/**
 * @param file The object's name within `<owner>/<conversation>/`, e.g.
 *   `abc123.glb` for a mesh or a bare image id for an image.
 */
export async function downloadConversationAsset({
  ownerId,
  conversationId,
  kind,
  file,
}: {
  ownerId: string;
  conversationId: string;
  kind: AssetKind;
  file: string;
}): Promise<Blob> {
  if (isConversationOwner(ownerId)) {
    const { data, error } = await supabase.storage
      .from(kind)
      .download(`${ownerId}/${conversationId}/${file}`);
    if (error) throw error;
    if (!data) throw new Error(`Asset not found: ${kind}/${file}`);
    return data;
  }

  const response = await fetch(
    publicAssetUrl({ conversationId, kind, file }),
    // No credentials: this endpoint is deliberately identity-free, and sending
    // cookies would imply otherwise.
    { credentials: 'omit' },
  );

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'This model is no longer shared publicly.'
        : `Failed to load ${kind} asset (${response.status})`,
    );
  }

  return response.blob();
}
