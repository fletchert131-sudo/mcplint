/** The I/O half of watch mode: turn a watched source into `trigger()` calls on
 *  a WatchLoop, and hand back a single teardown. The pure scheduling logic lives
 *  in `loop.ts`; this module only owns the OS resources (an `fs.watch` handle or
 *  a poll interval) and tears them down cleanly — the same split as
 *  `connect/stdio.ts` (I/O) vs `core/*` (pure). */
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { WatchLoop } from "./loop.js";

/** What watch mode observes. A file is watched for on-disk changes; a live
 *  server has no file, so it is re-linted on a fixed interval. */
export type WatchTarget =
  | { kind: "file"; file: string }
  | { kind: "interval"; everyMs: number };

export interface WatchHandle {
  /** Stop watching: clears the loop, the fs handle / interval, exactly once. */
  stop(): void;
}

export interface StartWatchOptions {
  target: WatchTarget;
  /** Re-lint + emit. Must resolve/reject; the loop won't overlap two of these. */
  run: () => Promise<void>;
  /** Quiet period after the last change before a re-lint, in ms. */
  debounceMs: number;
  /** A re-lint failed; keep watching (the loop already caught it). */
  onError?: (err: unknown) => void;
}

/** Begin watching. Triggers the first `run()` immediately is NOT done here — the
 *  caller does an initial lint before starting the watcher, so this only reacts
 *  to *subsequent* changes (matching how `tsc --watch`, vitest, etc. behave). */
export function startWatch(options: StartWatchOptions): WatchHandle {
  const loop = new WatchLoop(options.run, {
    debounceMs: options.debounceMs,
    onError: options.onError,
  });

  let fsHandle: FSWatcher | undefined;
  let intervalHandle: NodeJS.Timeout | undefined;

  if (options.target.kind === "file") {
    // `persistent: true` keeps the process alive while watching (the desired
    // behaviour — watch mode runs until the user quits). A watcher error (e.g.
    // the file is renamed away) surfaces through onError rather than crashing.
    fsHandle = fsWatch(options.target.file, { persistent: true }, () => loop.trigger());
    fsHandle.on("error", (err) => options.onError?.(err));
  } else {
    const everyMs = options.target.everyMs;
    intervalHandle = setInterval(() => loop.trigger(), everyMs);
  }

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      loop.stop();
      fsHandle?.close();
      if (intervalHandle) clearInterval(intervalHandle);
    },
  };
}
