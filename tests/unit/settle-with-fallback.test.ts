import { describe, expect, it, vi } from "vitest";

import { settleWithFallback } from "../../lib/util/settle-with-fallback";

describe("settleWithFallback", () => {
  it("resolves with the original value on success", async () => {
    await expect(settleWithFallback(Promise.resolve("ok"), "fallback")).resolves.toBe("ok");
  });

  it("resolves with the fallback instead of rejecting", async () => {
    await expect(
      settleWithFallback(Promise.reject(new Error("boom")), "fallback"),
    ).resolves.toBe("fallback");
  });

  it("never produces an unhandled rejection even when the caller never awaits it", async () => {
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      // Intentionally not awaited: this is the exact shape of the original
      // bug -- create the promise, then let something else in the caller
      // throw before this one is ever awaited.
      settleWithFallback(Promise.reject(new Error("boom")), "fallback");

      // Give Node's microtask/rejection-tracking queue a few turns to
      // surface any unhandled rejection before we assert none happened.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      // Remove only the listener this test added. Vitest installs its own
      // unhandledRejection listener to fail other tests on real unhandled
      // rejections -- process.removeAllListeners() would silently disable
      // that reporting for the rest of this worker's test run.
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
