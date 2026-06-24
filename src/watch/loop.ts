/** The bounded re-run loop behind watch mode. It owns three invariants that
 *  keep a long-running watcher cheap and correct, and that mirror the teardown
 *  discipline of `connect/stdio.ts`:
 *
 *   1. **Debounce.** Editors save in bursts (truncate then write) and `fs.watch`
 *      fires several events per save; a polling interval can also tick while a
 *      run is queued. We coalesce a burst of `trigger()`s into one run.
 *   2. **No overlapping runs.** A re-lint — especially a live re-spawn — can take
 *      seconds. If changes arrive while a run is in flight we record a single
 *      pending re-run instead of stacking N concurrent re-spawns. The loop never
 *      runs more than one `run()` at a time, so it can't fork-bomb the machine.
 *   3. **Clean teardown.** `stop()` cancels any pending timer and suppresses any
 *      in-flight run's follow-up, exactly once and idempotently.
 *
 *  It is pure of mcplint specifics: it just runs an injected async `run()` on a
 *  debounced, non-overlapping schedule. The CLI wires `fs.watch` / a poll
 *  interval to `trigger()` and passes a `run()` that re-lints and re-prints —
 *  which keeps this unit testable with fake timers and no I/O. */

export interface WatchLoopOptions {
  /** Quiet period after the last trigger before a run starts, in ms. */
  debounceMs: number;
  /** Called if a `run()` rejects, so the loop can keep watching instead of
   *  dying on a transient failure (e.g. a half-written file, a server that
   *  failed to start this time). Defaults to swallowing the error. */
  onError?: (err: unknown) => void;
}

export class WatchLoop {
  private timer: NodeJS.Timeout | undefined;
  /** A run is currently executing; new triggers set `pending` instead of racing. */
  private running = false;
  /** A trigger arrived during a run or after stop()? Re-run once it's safe. */
  private pending = false;
  private stopped = false;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly options: WatchLoopOptions,
  ) {}

  /** Schedule a (debounced) re-run. Safe to call as often as events fire. */
  trigger(): void {
    if (this.stopped) return;
    if (this.running) {
      // Don't start a concurrent run; remember that another is due once this
      // one finishes. Many mid-run triggers collapse into this one flag.
      this.pending = true;
      return;
    }
    // Restart the debounce window: the run fires once events go quiet.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.fire(), this.options.debounceMs);
    this.timer.unref?.();
  }

  /** Cancel everything and stop watching. Idempotent. */
  stop(): void {
    this.stopped = true;
    this.pending = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async fire(): Promise<void> {
    this.timer = undefined;
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.options.onError?.(err);
    } finally {
      this.running = false;
      // If changes arrived while we were running, re-run exactly once — through
      // the debounce again so another burst still coalesces.
      if (this.pending && !this.stopped) {
        this.pending = false;
        this.trigger();
      }
    }
  }
}
