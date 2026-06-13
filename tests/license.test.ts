import { describe, it, expect, afterEach, vi } from "vitest";
import { checkLicense, requirePro, UPGRADE_MESSAGE } from "../src/pro/license.js";

const savedDev = process.env.MCPLINT_DEV;
const savedKey = process.env.MCPLINT_LICENSE_KEY;

afterEach(() => {
  if (savedDev === undefined) delete process.env.MCPLINT_DEV;
  else process.env.MCPLINT_DEV = savedDev;
  if (savedKey === undefined) delete process.env.MCPLINT_LICENSE_KEY;
  else process.env.MCPLINT_LICENSE_KEY = savedKey;
  vi.unstubAllGlobals();
});

describe("license — dev-mode bypass", () => {
  it("MCPLINT_DEV=1 unlocks Pro", async () => {
    process.env.MCPLINT_DEV = "1";
    const status = await checkLicense();
    expect(status.pro).toBe(true);
    expect(status.reason).toBe("dev-mode");
  });

  it("requirePro resolves in dev mode", async () => {
    process.env.MCPLINT_DEV = "1";
    await expect(requirePro("report export")).resolves.toBeUndefined();
  });
});

describe("license — unlicensed paths (no network)", () => {
  it("throws an actionable error when the provider is unreachable", async () => {
    delete process.env.MCPLINT_DEV;
    process.env.MCPLINT_LICENSE_KEY = "test-key-not-real";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(requirePro("report export")).rejects.toThrow(/needs Pro/);
  });

  it("upgrade message tells the user how to activate", () => {
    expect(UPGRADE_MESSAGE).toContain("MCPLINT_LICENSE_KEY");
  });
});
