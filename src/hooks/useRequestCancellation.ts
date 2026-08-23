import { useCallback } from 'react';

/**
 * Historically this broadcast a `cancel` event on a Supabase Realtime channel
 * named `cancel-request-${messageId}`.
 *
 * Nothing ever subscribed to it. Grepping the whole tree for `cancel-request`
 * and `'cancel'` turns up only the sender — no server handler, no client
 * listener. The generation kept running and the signal went nowhere, so the
 * function has always been a no-op with extra steps.
 *
 * It is kept as a stub rather than deleted so the call sites and their UI
 * affordances stay intact, and so this note survives to explain why the
 * migration to Firestore did not port it: there was nothing to port.
 *
 * Actual cancellation already works by a different route — `abortSignal:
 * req.signal` in src/server/aiChat.ts aborts the model call when the client
 * disconnects the stream.
 */
export function useRequestCancellation() {
  const cancelRequest = useCallback(async (_messageId: string) => {
    // Intentionally empty. See the note above before adding anything here.
  }, []);

  return { cancelRequest };
}
