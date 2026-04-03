"use client";

import { useEffect } from "react";

/**
 * Sets the CSS custom property `--visual-vh` on `<html>` to the current
 * `window.visualViewport.height` (in px).  This updates live when the mobile
 * virtual keyboard opens/closes — unlike `dvh`/`svh` which many Android
 * browsers do NOT shrink for the keyboard.
 *
 * Usage in CSS / Tailwind:  `max-h-[calc(var(--visual-vh,100dvh)*0.9)]`
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      document.documentElement.style.setProperty(
        "--visual-vh",
        `${vv.height}px`
      );
    };

    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);
}
