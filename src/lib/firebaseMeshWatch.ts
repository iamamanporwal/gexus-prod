// Replacement for the Supabase broadcast channel that pushed mesh completion.
//
// Supabase Realtime had a pub/sub primitive: the server called
// `channel.send({ event: 'mesh-updated', payload })` and any subscribed client
// received it. Firestore has no equivalent — but it doesn't need one, because
// the thing being announced is a document change.
//
// Watching the document is strictly better than broadcasting about it:
//
//   - Broadcast is fire-and-forget. A client that was reloading, backgrounded,
//     or offline when the mesh finished never learned about it and sat on a
//     spinner until manually refreshed.
//   - onSnapshot delivers current state on attach, so a client that reconnects
//     immediately sees the finished mesh.
//
// The server no longer publishes anything for this; it just writes the mesh row,
// which it was already doing.

import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { getApps } from 'firebase/app';

export type MeshUpdate = {
  kind: 'mesh';
  id: string;
  conversation_id: string;
  status: string;
};

/**
 * Watches this user's meshes and reports each one whose status changes.
 *
 * Only transitions are reported, not the initial snapshot: attaching a listener
 * would otherwise replay every historical mesh as "just finished" and fire a
 * desktop notification per row on every page load.
 */
export function watchMeshUpdates(
  userId: string,
  onUpdate: (update: MeshUpdate) => void,
): Unsubscribe {
  const db = getFirestore(getApps()[0]);

  const q = query(collection(db, 'meshes'), where('user_id', '==', userId));

  // Seeded from the first snapshot so pre-existing rows are treated as known
  // rather than new.
  const lastSeenStatus = new Map<string, string>();
  let primed = false;

  return onSnapshot(
    q,
    (snapshot) => {
      if (!primed) {
        snapshot.docs.forEach((doc) =>
          lastSeenStatus.set(doc.id, String(doc.data().status ?? '')),
        );
        primed = true;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          lastSeenStatus.delete(change.doc.id);
          return;
        }

        const data = change.doc.data();
        const status = String(data.status ?? '');
        if (lastSeenStatus.get(change.doc.id) === status) return;

        lastSeenStatus.set(change.doc.id, status);
        onUpdate({
          kind: 'mesh',
          id: change.doc.id,
          conversation_id: String(data.conversation_id ?? ''),
          status,
        });
      });
    },
    (error) => {
      // A listener that dies silently looks exactly like a mesh that never
      // finishes, which is the single most confusing failure in this app.
      console.error('mesh watch failed', error);
    },
  );
}
