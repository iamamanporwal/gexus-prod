import { useEffect, useRef } from 'react';
import { useSharedSpinnerVerb } from '@/hooks/useSharedSpinnerVerb';
import {
  GEXUS_MARK_PATH,
  GEXUS_MARK_STROKE,
  GEXUS_MARK_VIEWBOX,
} from '@/utils/gexusMark';

type Props = {
  showLoadingText?: boolean;
};

const Loader = ({ showLoadingText = false }: Props) => {
  const dot2 = useRef<HTMLSpanElement>(null);
  const dot3 = useRef<HTMLSpanElement>(null);
  const sharedVerb = useSharedSpinnerVerb(showLoadingText);

  useEffect(() => {
    // ANIMATE LAST TWO DOTS WITH DELAYS AND INTERVALS
    const interval = setInterval(() => {
      dot2.current?.classList.toggle('opacity-0');
      setTimeout(() => {
        dot3.current?.classList.toggle('opacity-0');
      }, 300);
      setTimeout(() => {
        dot2.current?.classList.toggle('opacity-0');
        dot3.current?.classList.toggle('opacity-0');
      }, 600);
    }, 900);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative h-32 w-32">
        {/* The monogram draws itself and sweeps away, over and over. Because
            pathLength is normalised to 100 the dash animation in index.css can
            be written in plain percentages, whatever the real path length is. */}
        <svg
          viewBox={GEXUS_MARK_VIEWBOX}
          className="h-full w-full text-adam-text-primary"
          role="img"
          aria-label="Loading"
        >
          <path
            className="gexus-loader-stroke"
            pathLength={100}
            d={GEXUS_MARK_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={GEXUS_MARK_STROKE}
            strokeLinecap="butt"
            strokeLinejoin="miter"
          />
        </svg>
      </div>
      {showLoadingText && (
        <p className="mt-4 text-base text-adam-text-primary">
          {sharedVerb}
          <span>.</span>
          <span
            ref={dot2}
            className="opacity-0 transition-opacity duration-200"
          >
            .
          </span>
          <span
            ref={dot3}
            className="opacity-0 transition-opacity duration-200"
          >
            .
          </span>
        </p>
      )}
    </div>
  );
};

export default Loader;
