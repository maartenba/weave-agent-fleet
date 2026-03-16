/**
 * Shared async utilities for the server layer.
 */

/**
 * Race a promise against a timeout. Rejects with a TimeoutError if the
 * promise does not settle within `ms` milliseconds. The timer is always
 * cleaned up — no leaked timers on success.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(label, ms));
    }, ms);
    // Don't prevent Node.js from exiting
    if (timer.unref) {
      timer.unref();
    }
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}
