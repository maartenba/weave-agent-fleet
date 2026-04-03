"use client";

import { useEffect } from "react";

/**
 * Sets the CSS custom property `--visual-vh` on `<html>` to the actual
 * visible viewport height (in px).  This updates live when the mobile
 * virtual keyboard opens/closes.
 *
 * Uses the minimum of `visualViewport.height` and `window.innerHeight`
 * because different browsers report keyboard presence differently:
 * - Chrome Android: visualViewport.height shrinks, innerHeight doesn't
 * - Firefox Android: innerHeight shrinks, visualViewport may not
 * - Safari iOS: both shrink
 *
 * Listens to resize/scroll events on both VisualViewport and window.
 *
 * Usage in CSS / Tailwind:  `max-h-[var(--visual-vh,100dvh)]`
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (typeof window === "undefined") return;

    const update = () => {
      const vvh = vv ? vv.height : Infinity;
      const wih = window.innerHeight;
      const height = Math.min(vvh, wih);
      document.documentElement.style.setProperty(
        "--visual-vh",
        `${height}px`
      );
    };

    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);
}
