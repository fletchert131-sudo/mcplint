import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WatchLoop } from "../src/watch/loop.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A run function that records its invocations and can be made slow so we can
 *  exercise the "change arrived mid-run" path. */
function recorder(durationMs = 0) {
  const calls: number[] = [];
  let n = 0;
  const run = vi.fn(async () => {
    const me = ++n;
    calls.push(me);
    if (durationMs > 0) await new Promise<void>((r) => setTimeout(r, durationMs));
  });
  return { run, calls };
}

describe("WatchLoop — debounce", () => {
  it("coalesces a burst of triggers into a single run", async () => {
    const { run, calls } = recorder();
    const loop = new WatchLoop(run, { debounceMs: 50 });

    loop.trigger();
    loop.trigger();
    loop.trigger();
    expect(calls).toHaveLength(0); // nothing yet — still inside the debounce window

    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toEqual([1]); // one coalesced run, not three

    loop.stop();
  });

  it("runs again for a trigger that arrives after the window settles", async () => {
    const { run, calls } = recorder();
    const loop = new WatchLoop(run, { debounceMs: 50 });

    loop.trigger();
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toEqual([1]);

    loop.trigger();
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toEqual([1, 2]);

    loop.stop();
  });
});

describe("WatchLoop — no overlapping runs (bounded loop)", () => {
  it("does not start a second run while the first is still in flight", async () => {
    const { run, calls } = recorder(200);
    const loop = new WatchLoop(run, { debounceMs: 10 });

    loop.trigger();
    await vi.advanceTimersByTimeAsync(10); // debounce fires -> run #1 starts (200ms)

    // A change arrives mid-run; it must NOT start a concurrent run #2.
    loop.trigger();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual([1]); // still only the first run in flight

    // When run #1 finishes, exactly one follow-up run fires for the pending change.
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toEqual([1, 2]);

    loop.stop();
  });

  it("collapses many mid-run triggers into a single follow-up run", async () => {
    const { run, calls } = recorder(200);
    const loop = new WatchLoop(run, { debounceMs: 10 });

    loop.trigger();
    await vi.advanceTimersByTimeAsync(10); // run #1 starts

    loop.trigger();
    loop.trigger();
    loop.trigger(); // three changes during run #1

    await vi.advanceTimersByTimeAsync(200); // run #1 ends -> one follow-up
    await vi.advanceTimersByTimeAsync(10); // its debounce settles
    expect(calls).toEqual([1, 2]); // not [1,2,3,4]

    loop.stop();
  });
});

describe("WatchLoop — teardown", () => {
  it("a trigger after stop() never runs", async () => {
    const { run, calls } = recorder();
    const loop = new WatchLoop(run, { debounceMs: 50 });

    loop.trigger();
    loop.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(0);
  });

  it("stop() during the debounce window cancels the pending run", async () => {
    const { run, calls } = recorder();
    const loop = new WatchLoop(run, { debounceMs: 50 });

    loop.trigger();
    await vi.advanceTimersByTimeAsync(25); // still pending
    loop.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(0);
  });

  it("stop() is idempotent", () => {
    const { run } = recorder();
    const loop = new WatchLoop(run, { debounceMs: 50 });
    expect(() => {
      loop.stop();
      loop.stop();
    }).not.toThrow();
  });
});

describe("WatchLoop — a run that throws never breaks the loop", () => {
  it("keeps watching after a run rejects", async () => {
    let n = 0;
    const run = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("transient lint failure");
    });
    const onError = vi.fn();
    const loop = new WatchLoop(run, { debounceMs: 10, onError });

    loop.trigger();
    await vi.advanceTimersByTimeAsync(10); // run #1 throws
    expect(onError).toHaveBeenCalledTimes(1);

    loop.trigger();
    await vi.advanceTimersByTimeAsync(10); // run #2 still happens
    expect(run).toHaveBeenCalledTimes(2);

    loop.stop();
  });
});
