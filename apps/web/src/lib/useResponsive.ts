/**
 * useResponsive — viewport-width breakpoint hook for the mobile layout.
 *
 * The app switches to the single-column mobile shell (top nav bar + drawers
 * + bottom-pinned user panel) below MOBILE_BREAKPOINT, and keeps the desktop
 * multi-panel layout above it. Responsive in both orientations — portrait
 * phones get the mobile shell, landscape/tablets keep the wide layout.
 */
import { useEffect, useState } from 'react';
import { useLayoutPref } from '../stores/layoutPrefStore.js';

export const MOBILE_BREAKPOINT = 768;

export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  const forceMobile = useLayoutPref((s) => s.forceMobile);
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [breakpoint]);

  return forceMobile || narrow;
}
