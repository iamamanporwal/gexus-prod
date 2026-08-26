import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ensureGuestSession,
  currentAccount,
  subscribeToAccount,
  signOutAccount,
  type AccountSnapshot,
} from '@/lib/db';
import {
  AuthContext,
  type AuthContextValue,
  type SignInReason,
} from '@/contexts/AuthContext';
import { adoptProviderName, ensureProfile } from '@/services/profileService';
import { SignInDialog } from './SignInDialog';
import { useToast } from '@/hooks/use-toast';

/**
 * Boots the session and provides account state to the whole app.
 *
 * Replaces the old GuestSessionGate and keeps its central promise: nothing
 * below this point renders until a uid exists. Everything under here calls
 * `guestUserId()` synchronously — query filters, storage paths, the realtime
 * listener — and that function throws rather than returning a placeholder,
 * because a placeholder uid would write rows nobody can read back and Security
 * Rules would reject them anyway.
 *
 * The gate costs one round trip on a cold load and nothing afterwards: the
 * session persists in IndexedDB, so a returning visitor resolves from local
 * state.
 *
 * Runs client-side only. During SSR / prerender there is no session and no
 * IndexedDB, so children are not rendered on the server — which is correct
 * here: every child immediately needs a uid to fetch anything.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'pending' | 'ready' | 'failed'>('pending');
  const [message, setMessage] = useState<string>('');
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [signInReason, setSignInReason] = useState<SignInReason>('generic');
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  /**
   * Resolve a session, make sure it has a profiles row, then open the gate.
   * Used both at boot and whenever the session disappears underneath us.
   */
  const openGate = useCallback(async () => {
    try {
      const uid = await ensureGuestSession();
      // Create the profiles row before anything renders. useProfile,
      // UserAvatar and the notification preference all read it, and there is
      // no migration seeding one for a uid that was minted seconds ago.
      // Failure here must not block the app — a missing name is cosmetic, an
      // unusable app is not.
      try {
        await ensureProfile({
          userId: uid,
          fullName: currentAccount()?.displayName,
        });
      } catch (error) {
        console.warn('profile bootstrap failed', error);
      }
      setAccount(currentAccount());
      setState('ready');
    } catch (error: unknown) {
      // Surfaced rather than swallowed: the usual cause is Anonymous Auth
      // being disabled in the Firebase console, which otherwise presents as
      // an app that loads and then fails every query for no visible reason.
      setMessage(error instanceof Error ? error.message : String(error));
      setState('failed');
    }
  }, []);

  useEffect(() => {
    void openGate();
  }, [openGate]);

  // Track sign-in / sign-out for the lifetime of the app.
  const lastUidRef = useRef<string | null>(null);
  useEffect(() => {
    return subscribeToAccount((next) => {
      setAccount(next);

      if (!next) {
        // No session at all. This is NOT a state the app can render in:
        // useProfile, usePreview and PromptView all call `guestUserId()`
        // during render, and that function throws rather than returning a
        // placeholder. Leaving the tree mounted here crashes the app — which
        // is exactly what signing out did, since sign-out passes through this
        // state on its way to a fresh guest session.
        //
        // So re-gate, and mint a new guest. `ensureGuestSession` de-duplicates
        // with the call sign-out already made, so this cannot produce a second
        // anonymous account.
        lastUidRef.current = null;
        setState('pending');
        void openGate();
        return;
      }

      // Every cached query is scoped to a uid, so a change of uid invalidates
      // all of them at once — otherwise the new account briefly renders the
      // previous one's history.
      //
      // Guarded on the uid ACTUALLY changing. onAuthStateChanged also fires
      // for same-account transitions (the initial restore, and the anonymous →
      // Google link, which keeps the uid), and clearing there would throw away
      // in-flight queries the app has already started and make the whole UI
      // flash back to its loading state for no reason.
      if (lastUidRef.current !== null && lastUidRef.current !== next.uid) {
        queryClient.clear();
      }
      lastUidRef.current = next.uid;
    });
  }, [queryClient, openGate]);

  const requestSignIn = useCallback((reason: SignInReason = 'generic') => {
    setSignInReason(reason);
    setIsSignInOpen(true);
  }, []);

  const isSignedIn = !!account && !account.isAnonymous;

  const requireSignIn = useCallback(
    (reason: SignInReason = 'generic') => {
      if (isSignedIn) return true;
      requestSignIn(reason);
      return false;
    },
    [isSignedIn, requestSignIn],
  );

  const handleSignedIn = useCallback(
    async ({ broughtWorkAlong }: { broughtWorkAlong: boolean }) => {
      setIsSignInOpen(false);
      const next = currentAccount();
      setAccount(next);

      if (next) {
        try {
          await ensureProfile({
            userId: next.uid,
            fullName: next.displayName,
          });
          await adoptProviderName({
            userId: next.uid,
            fullName: next.displayName,
          });
        } catch (error) {
          console.warn('profile sync after sign-in failed', error);
        }
      }

      // Not a clear: linking an anonymous account keeps the uid, so every
      // cached conversation and mesh is still this person's and throwing it
      // away would just make the app blink. Only the profile actually changed.
      // A sign-in that switched uid is handled by the subscription above,
      // which clears on a real uid change.
      queryClient.invalidateQueries({ queryKey: ['profile'] });

      toast({
        title: broughtWorkAlong
          ? `Signed in as ${next?.displayName || next?.email || 'you'}`
          : 'Welcome back',
        description: broughtWorkAlong
          ? 'Your work is saved to your account.'
          : // Said plainly rather than hidden: this Google account already
            // existed, so the guest session's models stayed behind under the
            // old anonymous id and are not in this account's history.
            'You signed into an existing account, so models made as a guest in this browser stayed with the guest session.',
      });
    },
    [queryClient, toast],
  );

  const signOut = useCallback(async () => {
    // The subscription above does the rest: it re-gates the tree while there
    // is no session, mints the replacement guest, and clears the caches that
    // belonged to the account being left.
    await signOutAccount();
    setAccount(currentAccount());
    // The new guest owns nothing the previous account did, and its profile row
    // may have just been created — make sure nothing stale survives.
    queryClient.clear();
  }, [queryClient]);

  const displayName = useMemo(() => {
    if (!account || account.isAnonymous) return 'Guest';
    return account.displayName || account.email?.split('@')[0] || 'You';
  }, [account]);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      isSignedIn,
      displayName,
      requestSignIn,
      requireSignIn,
      signOut,
    }),
    [account, isSignedIn, displayName, requestSignIn, requireSignIn, signOut],
  );

  if (state === 'failed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-secondary-dark">
        <div className="max-w-xl px-4 text-center text-red-500">
          <p className="font-medium">Could not start a session.</p>
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

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SignInDialog
        open={isSignInOpen}
        reason={signInReason}
        onOpenChange={setIsSignInOpen}
        onSignedIn={handleSignedIn}
      />
    </AuthContext.Provider>
  );
}
