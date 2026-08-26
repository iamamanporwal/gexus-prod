import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { GoogleIcon } from '@/components/icons/CompanyIcons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { signInWithGoogle, SignInCancelledError } from '@/lib/db';
import { errorMessage } from '@/lib/errorMessage';

type GoogleSignInButtonProps = {
  /** Called after a successful sign-in, with whether guest work carried over. */
  onSignedIn?: (result: { broughtWorkAlong: boolean }) => void;
  className?: string;
  label?: string;
};

/**
 * The single place the Google popup is triggered from, so the login page and
 * the sign-in dialog cannot drift apart in behaviour or error handling.
 */
export function GoogleSignInButton({
  onSignedIn,
  className,
  label = 'Continue with Google',
}: GoogleSignInButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setIsPending(true);
    try {
      const result = await signInWithGoogle();
      onSignedIn?.({ broughtWorkAlong: result.broughtWorkAlong });
    } catch (caught) {
      // Closing the popup is a decision, not a failure — showing an error for
      // it would be scolding someone for changing their mind.
      if (caught instanceof SignInCancelledError) return;
      setError(signInErrorText(caught));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <Button
        variant="light"
        onClick={handleClick}
        disabled={isPending}
        className="h-11 w-full gap-3 text-sm font-medium"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleIcon className="h-4 w-4" />
        )}
        {isPending ? 'Opening Google…' : label}
      </Button>
      {error ? (
        <p role="alert" className="text-center text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function signInErrorText(error: unknown): string {
  const code =
    typeof (error as { code?: unknown })?.code === 'string'
      ? (error as { code: string }).code
      : '';

  // These two are configuration problems, not user problems, and the raw
  // Firebase text ("auth/unauthorized-domain") tells the user nothing about
  // what to do. Name the actual fix so whoever sees it can act.
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorised for sign-in. Add it under Firebase Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in is not enabled for this project yet.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error reaching Google. Check your connection and try again.';
  }
  return errorMessage(
    error,
    'Could not sign in with Google. Please try again.',
  );
}
