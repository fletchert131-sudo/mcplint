import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWatch, type WatchHandle } from "../src/watch/source.js";

/** Integration test for the watch driver against a real file and real fs.watch
 *  (no fakes) — proves the wiring the unit test of WatchLoop can't: an actual
 *  on-disk write produces a re-run, and stop() releases the OS handle. Bounded
 *  with short waits so it stays fast and deterministic. */

let handle: WatchHandle | undefined;
const created: string[] = [];

afterEach(async () => {
  handle?.stop();
  handle = undefined;
  for (const f of created.splice(0)) await fs.rm(f, { force: true });
});

function tmpFile(name: string): string {
  const p = join(tmpdir(), `mcplint-watch-${process.pid}-${Date.now()}-${name}`);
  created.push(p);
  return p;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("startWatch — file target", () => {
  it("re-runs after the file is written, then stops cleanly", async () => {
    const file = tmpFile("tools.json");
    await fs.writeFile(file, "[]", "utf8");

    let runs = 0;
    handle = startWatch({
      target: { kind: "file", file },
      run: async () => {
        runs++;
      },
      debounceMs: 40,
    });

    // startWatch does NOT fire an initial run (the CLI lints once before
    // watching), so nothing has happened yet.
    await wait(60);
    expect(runs).toBe(0);

    await fs.writeFile(file, '[{"name":"x"}]', "utf8");
    await wait(200);
    expect(runs).toBeGreaterThanOrEqual(1);

    const after = runs;
    handle.stop();
    await fs.writeFile(file, "[]", "utf8");
    await wait(150);
    expect(runs).toBe(after); // no re-runs once stopped
  });

  it("coalesces a rapid burst of writes into a single re-run", async () => {
    const file = tmpFile("burst.json");
    await fs.writeFile(file, "[]", "utf8");

    let runs = 0;
    handle = startWatch({
      target: { kind: "file", file },
      run: async () => {
        runs++;
      },
      debounceMs: 80,
    });

    for (let i = 0; i < 5; i++) {
      await fs.writeFile(file, `[{"name":"t${i}"}]`, "utf8");
      await wait(10); // faster than the 80ms debounce — all collapse into one
    }
    await wait(200);
    expect(runs).toBe(1);
  });
});

describe("startWatch — interval target", () => {
  it("re-runs on the interval and stops cleanly", async () => {
    let runs = 0;
    handle = startWatch({
      target: { kind: "interval", everyMs: 40 },
      run: async () => {
        runs++;
      },
      debounceMs: 5,
    });

    await wait(180); // ~4 ticks
    expect(runs).toBeGreaterThanOrEqual(2);

    const after = runs;
    handle.stop();
    await wait(120);
    expect(runs).toBe(after); // interval cleared
  });
});
