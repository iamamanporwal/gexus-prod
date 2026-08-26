import { useEffect } from 'react';
import { useNavigate, useSearch, Link } from '@tanstack/react-router';
import { Check, Loader2 } from 'lucide-react';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { useAuth } from '@/contexts/AuthContext';
import { publicPath, validateRedirectUrl } from '@/lib/utils';

const BENEFITS = [
  'Generate 3D models from a prompt or an image',
  'Keep every model in one place, on any device',
  'Share a link anyone can open — no account needed to view',
];

/**
 * The standalone sign-in page.
 *
 * The dialog (SignInDialog) handles sign-in raised mid-task; this page handles
 * sign-in as a destination — a link someone was sent, a bookmark, the
 * redirect target after a gated action. Both call the same
 * `GoogleSignInButton`, so there is one sign-in implementation and one place
 * errors are worded.
 */
export function LoginView() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const search = useSearch({ from: '/login' });
  // Sanitised, not used raw: `redirect` is attacker-controllable through the
  // URL, and navigating to it unchecked is an open redirect.
  const redirect = validateRedirectUrl(search.redirect ?? null, '/');

  // Someone already signed in has nothing to do here — send them where they
  // were going. Also covers the moment right after a successful sign-in.
  useEffect(() => {
    if (isSignedIn) navigate({ href: redirect, replace: true });
  }, [isSignedIn, navigate, redirect]);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-adam-bg-dark px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-adam-neutral-800 bg-adam-bg-secondary-dark shadow-[0_0_60px_rgba(0,0,0,0.35)] md:grid-cols-2">
        {/* Sign-in column */}
        <div className="flex flex-col justify-center gap-8 p-8 md:p-12">
          <Link to="/" className="w-fit">
            <img
              src={publicPath('cadam-logo.svg')}
              alt="GEXUS"
              className="h-8 w-auto"
            />
          </Link>

          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-medium tracking-tight text-adam-text-primary md:text-3xl">
              Welcome to GEXUS
            </h1>
            <p className="text-sm leading-relaxed text-adam-text-secondary">
              Sign in to build, save and share 3D models.
            </p>
          </div>

          {isSignedIn ? (
            <div className="flex items-center gap-2 text-sm text-adam-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing you in…
            </div>
          ) : (
            <GoogleSignInButton
              onSignedIn={() => navigate({ href: redirect, replace: true })}
            />
          )}

          <p className="text-xs leading-relaxed text-adam-text-tertiary">
            Anything you have already made in this browser comes with you when
            you sign in. By continuing you agree to our{' '}
            <Link
              to="/terms-of-service"
              className="underline underline-offset-2 hover:text-adam-text-secondary"
            >
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link
              to="/privacy-policy"
              className="underline underline-offset-2 hover:text-adam-text-secondary"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* Value column. Hidden on mobile, where it would push the actual
            sign-in button below the fold. */}
        <div className="hidden flex-col justify-center gap-6 border-l border-adam-neutral-800 bg-adam-neutral-950/40 p-12 md:flex">
          <h2 className="text-sm font-medium uppercase tracking-wider text-adam-text-tertiary">
            What you get
          </h2>
          <ul className="flex flex-col gap-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-adam-blue/15 text-adam-blue">
                  <Check className="h-3 w-3" />
                </span>
                <span className="text-sm leading-relaxed text-adam-text-secondary">
                  {benefit}
                </span>
              </li>
            ))}
          </ul>

          <Link
            to="/"
            className="w-fit text-xs text-adam-text-tertiary underline underline-offset-2 hover:text-adam-text-secondary"
          >
            Keep looking around without an account
          </Link>
        </div>
      </div>
    </div>
  );
}
