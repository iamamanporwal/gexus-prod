import { Link } from '@tanstack/react-router';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publicPath } from '@/lib/utils';

type ShareHeaderProps = {
  title: string;
  isRemixing: boolean;
  onRemix: () => void;
};

/**
 * The bar a share-link visitor sees first.
 *
 * Its job is to answer three things at a glance: what am I looking at, who made
 * it, and what can I do with it. The remix button is the only primary action —
 * the whole point of a shared link is that the person on the other end can
 * pick the model up and keep going.
 */
export function ShareHeader({ title, isRemixing, onRemix }: ShareHeaderProps) {
  return (
    <header className="flex w-full shrink-0 items-center justify-between gap-4 border-b border-adam-neutral-800 bg-adam-bg-secondary-dark px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/" className="shrink-0">
          <img
            src={publicPath('gexus-wordmark.svg')}
            alt="GEXUS"
            className="h-4 w-auto"
          />
        </Link>
        <div className="hidden h-5 w-px bg-adam-neutral-800 sm:block" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-adam-text-primary">
            {title || 'Shared model'}
          </span>
          {/* No author name: profiles are private (see firestore.rules), and
              a public link deliberately exposes the model, not its maker. */}
          <span className="truncate text-xs text-adam-text-tertiary">
            Shared with you · built on GEXUS
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="light"
          onClick={onRemix}
          disabled={isRemixing}
          className="h-9 gap-2 px-4 text-sm"
        >
          {isRemixing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {isRemixing ? 'Copying…' : 'Remix'}
        </Button>
      </div>
    </header>
  );
}
