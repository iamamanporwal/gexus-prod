import { Eye, EyeOff } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Eye toggle that hides one layer of the model in the viewer. Hiding is
 * render-only — the part stays in the OpenSCAD source and in every export, so
 * this is purely a way to look inside an assembly.
 */
export function PartVisibilityToggle({
  isHidden,
  onToggle,
  label,
}: {
  isHidden: boolean;
  onToggle: () => void;
  label: string;
}) {
  const Icon = isHidden ? EyeOff : Eye;
  const action = isHidden ? 'Show' : 'Hide';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            aria-label={`${action} ${label}`}
            aria-pressed={isHidden}
            className={cn(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-200 ease-out focus:outline-none',
              isHidden
                ? 'text-adam-text-primary [@media(hover:hover)]:hover:bg-adam-neutral-700'
                : 'text-adam-neutral-400 [@media(hover:hover)]:hover:bg-adam-neutral-800 [@media(hover:hover)]:hover:text-adam-text-primary',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {action} {label}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
