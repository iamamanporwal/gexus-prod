import { useState, type FormEvent } from 'react';
import { ArrowUp, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

type SharePromptBarProps = {
  isSignedIn: boolean;
  isPending: boolean;
  /** Receives the typed prompt; empty string when the person just hit send. */
  onSubmit: (prompt: string) => void;
  /** Called on the first interaction by someone who is not signed in. */
  onBlockedInteraction: () => void;
};

/**
 * The prompt input on a shared model.
 *
 * A read-only page with no input at all tells a visitor "you can look" and
 * nothing else. Showing a real input tells them they can build on this — and
 * the sign-in prompt then arrives attached to something they were already
 * doing, which is the moment it is easiest to say yes to.
 *
 * Signed out, the field is deliberately still focusable and typeable: the gate
 * fires on the first keystroke or on submit, so nobody is stopped before they
 * have expressed what they wanted. A disabled input would just look broken.
 */
export function SharePromptBar({
  isSignedIn,
  isPending,
  onSubmit,
  onBlockedInteraction,
}: SharePromptBarProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    if (!isSignedIn) {
      onBlockedInteraction();
      return;
    }
    onSubmit(value.trim());
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full shrink-0 border-t border-adam-neutral-800 bg-adam-bg-secondary-dark px-3 py-3 md:px-4"
    >
      <div
        className={cn(
          'mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-adam-neutral-700 bg-adam-neutral-950 px-4 py-2.5',
          'focus-within:border-adam-neutral-500',
        )}
      >
        {!isSignedIn && (
          <Lock className="h-4 w-4 shrink-0 text-adam-text-tertiary" />
        )}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => {
            if (!isSignedIn) onBlockedInteraction();
          }}
          placeholder={
            isSignedIn
              ? 'Describe a change to make your own version…'
              : 'Sign in to build on this model…'
          }
          className="min-w-0 flex-1 bg-transparent text-sm text-adam-text-primary outline-none placeholder:text-adam-text-tertiary"
          aria-label="Prompt"
        />
        <button
          type="submit"
          disabled={isPending}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-adam-neutral-10 text-adam-neutral-950 transition-opacity disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-adam-text-tertiary">
        Editing here makes your own copy — the original stays exactly as it is.
      </p>
    </form>
  );
}
