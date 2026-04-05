import { useState, useEffect } from 'react';

/**
 * useIsMobile — reactive mobile breakpoint hook.
 *
 * Returns true when viewport width is below the given breakpoint (default 640px).
 * Updates on window resize.
 */
export function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);

  return isMobile;
}
