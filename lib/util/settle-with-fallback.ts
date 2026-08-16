/**
 * Wrap a promise so it can never become an unhandled rejection, no matter
 * what the caller does with it afterward -- including never awaiting it,
 * because something earlier in the same function threw first.
 *
 * This matters for the "start a background check, await something else,
 * then await the background check" pattern: if the something-else throws
 * before the background promise is awaited, a plain rejected promise is
 * left unobserved. Node treats that as an unhandled rejection. Attaching
 * `.catch()` here, at creation time, means the promise settles immediately
 * regardless of whether the caller ever looks at it again.
 */
export function settleWithFallback<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}
