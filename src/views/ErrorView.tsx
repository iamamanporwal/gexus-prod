import { Button } from '@/components/ui/button';
import { useNavigate } from '@tanstack/react-router';
import * as Sentry from '@sentry/react';
import { useEffect } from 'react';

export function ErrorView({ error }: { error?: unknown }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (error) {
      Sentry.captureException(error);
    }
  }, [error]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-adam-bg-secondary-dark">
      <h1 className="text-2xl font-bold text-adam-text-primary">
        Oops! Something went wrong.
      </h1>
      <p className="text-center text-adam-text-secondary">
        We're sorry, but an error occurred while loading this page.
        <br />
        Please feel free to reach out to us so that we can resolve this issue.
      </p>
      {/* The concrete failure, not just the apology. Sentry gets the full
          exception above, but the person looking at this screen is often
          the one reporting the bug — a one-line reason turns "something
          went wrong" screenshots into actionable reports. */}
      {error !== undefined && error !== null && (
        <p className="max-w-xl break-words px-4 text-center font-mono text-xs text-adam-text-secondary opacity-70">
          {error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)}
        </p>
      )}
      <Button onClick={() => navigate({ to: '/' })}>Go to Home</Button>
    </div>
  );
}
