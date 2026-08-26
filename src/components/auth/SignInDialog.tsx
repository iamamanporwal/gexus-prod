import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { GoogleSignInButton } from './GoogleSignInButton';
import type { SignInReason } from '@/contexts/AuthContext';
import { publicPath } from '@/lib/utils';

/**
 * Copy per reason.
 *
 * Written so the dialog answers "why am I seeing this?" in its first line. A
 * generic "Sign in to continue" makes an interruption feel arbitrary; naming
 * the thing the person just tried to do makes it feel like a step.
 */
const COPY: Record<SignInReason, { title: string; body: string }> = {
  edit: {
    title: 'Sign in to edit this model',
    body: 'Anyone can explore this model. Sign in to change it and keep your own copy.',
  },
  prompt: {
    title: 'Sign in to start building',
    body: 'Sign in to send a prompt and generate your own 3D models.',
  },
  remix: {
    title: 'Sign in to remix this model',
    body: 'Remixing makes a copy in your workspace that you can edit freely — the original stays exactly as it is.',
  },
  save: {
    title: 'Sign in to save your work',
    body: 'Your models are stored with your account, so they follow you to any device.',
  },
  share: {
    title: 'Sign in to share',
    body: 'Sign in so people you share with can see who made this.',
  },
  generic: {
    title: 'Sign in to GEXUS',
    body: 'Continue with Google to build, save and share 3D models.',
  },
};

type SignInDialogProps = {
  open: boolean;
  reason: SignInReason;
  onOpenChange: (open: boolean) => void;
  onSignedIn: (result: { broughtWorkAlong: boolean }) => void;
};

export function SignInDialog({
  open,
  reason,
  onOpenChange,
  onSignedIn,
}: SignInDialogProps) {
  const copy = COPY[reason] ?? COPY.generic;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-auto w-[calc(100%-2rem)] max-w-md gap-0 rounded-2xl border border-adam-neutral-800 bg-adam-bg-secondary-dark p-0 text-adam-text-primary">
        <div className="flex flex-col items-center gap-6 px-8 pb-8 pt-10">
          <img
            src={publicPath('cadam-logo.svg')}
            alt=""
            aria-hidden="true"
            className="h-8 w-auto"
          />

          <div className="flex flex-col items-center gap-2 text-center">
            <DialogTitle className="text-xl font-medium tracking-tight">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="max-w-[22rem] text-sm leading-relaxed text-adam-text-secondary">
              {copy.body}
            </DialogDescription>
          </div>

          <GoogleSignInButton onSignedIn={onSignedIn} />

          <p className="max-w-[22rem] text-center text-xs leading-relaxed text-adam-text-tertiary">
            Anything you have already made in this browser comes with you when
            you sign in.
          </p>
        </div>

        <div className="border-t border-adam-neutral-800 px-8 py-4">
          <p className="text-center text-[11px] leading-relaxed text-adam-text-tertiary">
            By continuing you agree to our{' '}
            <a
              href={publicPath('terms-of-service')}
              className="underline underline-offset-2 hover:text-adam-text-secondary"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href={publicPath('privacy-policy')}
              className="underline underline-offset-2 hover:text-adam-text-secondary"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
