"use client";

/**
 * Global error boundary — renders outside of RootLayout.
 * Must be fully standalone (own <html>/<body>) with no provider dependencies.
 * Required to prevent Next.js 16 _global-error prerender crash.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ textAlign: "center" }}>
            <h2>Something went wrong</h2>
            <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
