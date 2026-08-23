import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

/**
 * Key used for the bucket of faces that carry no explicit `color()` call.
 * Those faces render in the brand fallback color and have no corresponding
 * OpenSCAD parameter, so the panel surfaces them under a synthetic row.
 * Must match the key written by `buildColoredGroupFromOff`.
 */
export const UNPAINTED_PART_KEY = '__default';

interface PartVisibilityContextType {
  // Uppercase `#RRGGBB` keys (or UNPAINTED_PART_KEY) currently hidden.
  hidden: ReadonlySet<string>;
  isHidden: (key: string) => boolean;
  toggle: (key: string) => void;
  showAll: () => void;
  // Part keys the renderer actually produced for the current model. The panel
  // uses this to decide whether to offer an "Unpainted" row.
  availableKeys: ReadonlySet<string>;
  registerParts: (keys: string[]) => void;
  /**
   * Follow a part through a color edit. Recoloring a hidden part changes its
   * bucket key, which would otherwise make it silently reappear (and leave the
   * old hex hidden forever, so an unrelated part later assigned that hex would
   * vanish).
   */
  remap: (fromKey: string, toKey: string) => void;
}

const PartVisibilityContext = createContext<
  PartVisibilityContextType | undefined
>(undefined);

export function PartVisibilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [availableKeys, setAvailableKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const showAll = useCallback(() => {
    setHidden((prev) => (prev.size === 0 ? prev : new Set<string>()));
  }, []);

  const registerParts = useCallback((keys: string[]) => {
    setAvailableKeys((prev) => {
      // Recompiles fire this on every parameter tweak; bail out when the key
      // set is unchanged so the panel and viewer don't re-render needlessly.
      if (prev.size === keys.length && keys.every((key) => prev.has(key))) {
        return prev;
      }
      return new Set(keys);
    });
  }, []);

  const remap = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setHidden((prev) => {
      if (!prev.has(fromKey)) return prev;
      const next = new Set(prev);
      next.delete(fromKey);
      next.add(toKey);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      hidden,
      isHidden,
      toggle,
      showAll,
      availableKeys,
      registerParts,
      remap,
    }),
    [hidden, isHidden, toggle, showAll, availableKeys, registerParts, remap],
  );

  return (
    <PartVisibilityContext.Provider value={value}>
      {children}
    </PartVisibilityContext.Provider>
  );
}

/**
 * Read the part-visibility state. Returns undefined outside a provider —
 * previews rendered without one (history thumbnails, share cards) keep their
 * existing always-visible behavior instead of throwing.
 */
export function usePartVisibility(): PartVisibilityContextType | undefined {
  return useContext(PartVisibilityContext);
}
