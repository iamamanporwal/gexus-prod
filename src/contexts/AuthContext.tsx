import { createContext, useContext } from 'react';
import type { AccountSnapshot } from '@/lib/db';

export type SignInReason =
  | 'edit'
  | 'prompt'
  | 'remix'
  | 'save'
  | 'share'
  | 'generic';

export type AuthContextValue = {
  /** The current account. Null only before the boot gate resolves. */
  account: AccountSnapshot | null;
  /** True once a real (non-anonymous) account is signed in. */
  isSignedIn: boolean;
  /** Display name, falling back to the email local-part, then "Guest". */
  displayName: string;

  /**
   * Opens the sign-in dialog. `reason` selects the copy shown above the Google
   * button, so the prompt explains the specific thing the person was trying to
   * do rather than a generic "please sign in".
   */
  requestSignIn: (reason?: SignInReason) => void;

  /**
   * Gate for actions that need a real account.
   *
   * Returns true when the person is signed in and the caller should proceed.
   * Returns false after opening the sign-in dialog, so the call site reads as
   * `if (!requireSignIn('prompt')) return;`.
   */
  requireSignIn: (reason?: SignInReason) => boolean;

  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
