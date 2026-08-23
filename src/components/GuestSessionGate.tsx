import { useEffect, useState } from 'react';
import { ensureGuestSession } from '@/lib/db';

/**
 * Blocks rendering until the anonymous Firebase session exists.
 *
 * Everything below this point calls `guestUserId()` synchronously — query
 * filters, storage paths, the realtime listener — and that function throws
 * rather than returning a placeholder, because a placeholder uid would write
 * rows nobody can read back and Security Rules would reject them anyway.
 *
 * The gate costs one round trip on a cold load and nothing afterwards: the
 * session persists in IndexedDB, so a returning visitor resolves from local
 * state.
 *
 * Runs client-side only. During SSR / prerender there is no session and no
 * IndexedDB, so children are not rendered on the server — which is correct
 * here: every child immediately needs a uid to fetch anything.
 */
export function GuestSessionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'pending' | 'ready' | 'failed'>('pending');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    ensureGuestSession()
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Surfaced rather than swallowed: the usual cause is Anonymous Auth
        // being disabled in the Firebase console, which otherwise presents as
        // an app that loads and then fails every query for no visible reason.
        setMessage(error instanceof Error ? error.message : String(error));
        setState('failed');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'failed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-secondary-dark">
        <div className="max-w-xl px-4 text-center text-red-500">
          <p className="font-medium">Could not start a guest session.</p>
          <p className="mt-2 text-sm opacity-80">{message}</p>
          <p className="mt-2 text-sm opacity-80">
            Check that Anonymous sign-in is enabled for this Firebase project.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-secondary-dark" />
    );
  }

  return <>{children}</>;
}
