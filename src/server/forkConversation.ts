// "Remix" — copies a publicly shared conversation into the caller's account.
//
// This is the growth loop the share feature exists for: someone opens a link,
// likes the model, and wants to change it. Without a fork they would have to
// start from an empty prompt, which throws away the thing that made them click.
//
// A fork is a DEEP copy, and it has to be. A shallow copy — new conversation
// rows pointing at the original's meshes — would produce an editor whose viewer
// is empty, because every stored object lives under the ORIGINAL owner's uid
// prefix and Storage rules authorise on exactly that prefix. So the documents
// AND the bytes are duplicated under the new owner.
//
// The one subtle part is reference rewriting. Message parts embed ids in
// several shapes at once: a file part's `filename` is `<imageId>.png`, its
// `url` is a storage-style path containing the uid, the conversation id and the
// image id, and a `create_mesh` tool result carries `{ id: <meshId> }`. Rather
// than teach this file every shape (and miss one), each message's parts are
// serialised to JSON and every OLD id is string-replaced with its NEW id. The
// ids are long unique tokens, so replacement cannot collide with unrelated
// text, and it stays correct when the part shapes change.

import { corsHeaders, isRecord, isUnauthorizedError, requireUser } from './api';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import { adminBucket } from './firestoreAdmin';
import { logError } from './serverLog';

// Enough for any real conversation, low enough that a pathological one cannot
// stall the function. Exceeding either is reported rather than silently cut.
const MAX_MESSAGES = 500;
const MAX_OBJECTS_PER_BUCKET = 300;

const ASSET_TABLES = ['meshes', 'images', 'previews'] as const;
type AssetTable = (typeof ASSET_TABLES)[number];

type Row = Record<string, unknown>;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function handleForkConversationRequest(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (error) {
    if (isUnauthorizedError(error)) return json({ error: 'Unauthorized' }, 401);
    throw error;
  }

  let sourceId = '';
  try {
    const body: unknown = await request.json();
    if (isRecord(body) && typeof body.conversationId === 'string') {
      sourceId = body.conversationId;
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sourceId)) {
    return json({ error: 'Invalid conversation id' }, 400);
  }

  const db = getServiceRoleSupabaseClient();

  try {
    const { data: source } = await db
      .from('conversations')
      .select('*')
      .eq('id', sourceId)
      .limit(1)
      .maybeSingle();

    if (!source) return json({ error: 'Conversation not found' }, 404);

    const ownerId = String(source.user_id ?? '');
    const isOwner = ownerId === userId;

    // Only a public conversation may be forked by someone else. Owners can
    // fork their own privately, which is what "duplicate" means for them.
    if (!isOwner && source.privacy !== 'public') {
      return json({ error: 'Conversation not found' }, 404);
    }

    const newConversationId = crypto.randomUUID();

    // ── Build the id map ───────────────────────────────────────────────────
    // Old token → new token, covering everything embedded in message parts.
    const idMap = new Map<string, string>();
    idMap.set(sourceId, newConversationId);
    if (ownerId && ownerId !== userId) idMap.set(ownerId, userId);

    const assetRows: Record<AssetTable, Row[]> = {
      meshes: [],
      images: [],
      previews: [],
    };

    for (const table of ASSET_TABLES) {
      const { data } = await db
        .from(table)
        .select('*')
        .eq('conversation_id', sourceId);
      const rows = (data ?? []) as Row[];
      assetRows[table] = rows;
      for (const row of rows) {
        const oldId = String(row.id);
        if (oldId) idMap.set(oldId, crypto.randomUUID());
      }
    }

    const { data: messageData } = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', sourceId)
      .order('created_at', { ascending: true });

    const messages = (messageData ?? []) as Row[];
    const truncated = messages.length > MAX_MESSAGES;
    const messagesToCopy = truncated ? messages.slice(-MAX_MESSAGES) : messages;

    for (const message of messagesToCopy) {
      idMap.set(String(message.id), crypto.randomUUID());
    }

    const remap = makeRemapper(idMap);

    // ── Copy stored objects ────────────────────────────────────────────────
    // Before the rows, so a row never points at bytes that are not there yet.
    // GCS copies server-side, so nothing streams through this function.
    let copiedObjects = 0;
    if (ownerId) {
      for (const bucketName of ASSET_TABLES) {
        copiedObjects += await copyFolder({
          bucketName,
          fromPrefix: `${bucketName}/${ownerId}/${sourceId}/`,
          toPrefix: `${bucketName}/${userId}/${newConversationId}/`,
          remap,
        });
      }
    }

    // ── Copy the rows ──────────────────────────────────────────────────────
    const now = new Date().toISOString();

    const { error: conversationError } = await db.from('conversations').insert({
      ...source,
      id: newConversationId,
      user_id: userId,
      // A fork is always private. Inheriting `public` would republish someone
      // else's work under a new link without them ever deciding to.
      privacy: 'private',
      title: forkTitle(source.title),
      current_message_leaf_id: source.current_message_leaf_id
        ? (idMap.get(String(source.current_message_leaf_id)) ?? null)
        : null,
      created_at: now,
      updated_at: now,
      // Recorded so the original is attributable and a future "forked from"
      // affordance has the data it needs. Nothing reads it yet.
      forked_from_conversation_id: sourceId,
      forked_from_user_id: ownerId || null,
    });
    if (conversationError) throw conversationError;

    for (const table of ASSET_TABLES) {
      for (const row of assetRows[table]) {
        const newId = idMap.get(String(row.id));
        if (!newId) continue;
        const next: Row = {
          ...row,
          id: newId,
          user_id: userId,
          conversation_id: newConversationId,
        };
        // meshes.images and previews.mesh_id hold ids of sibling rows, which
        // have all been remapped too.
        if (Array.isArray(row.images)) {
          next.images = row.images.map(
            (value) => idMap.get(String(value)) ?? value,
          );
        }
        if (typeof row.mesh_id === 'string') {
          next.mesh_id = idMap.get(row.mesh_id) ?? row.mesh_id;
        }
        const { error } = await db.from(table).insert(next);
        if (error) throw error;
      }
    }

    for (const message of messagesToCopy) {
      const newId = idMap.get(String(message.id));
      if (!newId) continue;
      const parentId = message.parent_message_id
        ? idMap.get(String(message.parent_message_id))
        : null;
      const { error } = await db.from('messages').insert({
        ...message,
        id: newId,
        conversation_id: newConversationId,
        // A parent outside the copied window would dangle and break Tree's
        // path walk, so an orphan is re-rooted rather than left pointing at
        // a message that does not exist here.
        parent_message_id: parentId ?? null,
        parts: remap(message.parts),
        metadata: remap(message.metadata),
        ...(message.content !== undefined && {
          content: remap(message.content),
        }),
      });
      if (error) throw error;
    }

    return json(
      {
        conversationId: newConversationId,
        copiedMessages: messagesToCopy.length,
        copiedObjects,
        ...(truncated && { truncatedTo: MAX_MESSAGES }),
      },
      200,
    );
  } catch (error) {
    logError(error, {
      functionName: 'fork-conversation',
      statusCode: 500,
      userId,
      conversationId: sourceId,
    });
    return json({ error: 'Failed to remix this model' }, 500);
  }
}

/** Replaces every mapped id anywhere inside a JSON-serialisable value. */
function makeRemapper(idMap: Map<string, string>) {
  const entries = [...idMap.entries()];
  return <T>(value: T): T => {
    if (value === undefined || value === null) return value;
    let serialised = JSON.stringify(value);
    if (serialised === undefined) return value;
    for (const [from, to] of entries) {
      serialised = serialised.split(from).join(to);
    }
    return JSON.parse(serialised) as T;
  };
}

/** `Coffee mug` → `Coffee mug (remix)`, without stacking suffixes forever. */
function forkTitle(title: unknown): string {
  const text =
    typeof title === 'string' && title.trim() ? title.trim() : 'Remix';
  return text.endsWith('(remix)') ? text : `${text} (remix)`;
}

async function copyFolder({
  fromPrefix,
  toPrefix,
  remap,
}: {
  bucketName: string;
  fromPrefix: string;
  toPrefix: string;
  remap: <T>(value: T) => T;
}): Promise<number> {
  const bucket = adminBucket();
  const [files] = await bucket.getFiles({ prefix: fromPrefix });

  let copied = 0;
  for (const file of files.slice(0, MAX_OBJECTS_PER_BUCKET)) {
    const name = file.name.slice(fromPrefix.length);
    if (!name) continue;
    // Object names embed the row id (`<meshId>.glb`, `preview-<meshId>`), so
    // they go through the same remapping the documents did.
    const destination = `${toPrefix}${remap(name)}`;
    try {
      await file.copy(bucket.file(destination));
      copied += 1;
    } catch (error) {
      // One unreadable object must not sink the whole remix — the rest of the
      // conversation is still worth having.
      console.warn('fork: failed to copy object', file.name, error);
    }
  }
  return copied;
}
