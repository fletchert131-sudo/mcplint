import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import { checkLicense, requirePro, verifyKey, UPGRADE_MESSAGE } from "../src/pro/license.js";

const savedDev = process.env.MCPLINT_DEV;
const savedKey = process.env.MCPLINT_LICENSE_KEY;

afterEach(() => {
  if (savedDev === undefined) delete process.env.MCPLINT_DEV;
  else process.env.MCPLINT_DEV = savedDev;
  if (savedKey === undefined) delete process.env.MCPLINT_LICENSE_KEY;
  else process.env.MCPLINT_LICENSE_KEY = savedKey;
});

/** Mint a key the same way scripts/issue-license.mjs does, with a test key. */
function mint(email: string, privateKey: KeyObject, issued = "2026-06-27"): string {
  const payloadSeg = Buffer.from(JSON.stringify({ email, issued })).toString("base64url");
  const sig = edSign(null, Buffer.from(payloadSeg), privateKey).toString("base64url");
  return `mcpl_${payloadSeg}.${sig}`;
}

const pubPem = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();

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

describe("license — offline signature verification", () => {
  it("accepts a correctly signed key and returns the licensed email", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const key = mint("dev@acme.com", privateKey);
    expect(verifyKey(key, pubPem(publicKey))?.email).toBe("dev@acme.com");
  });

  it("rejects a key whose payload was tampered with (signature no longer matches)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const key = mint("dev@acme.com", privateKey);
    const forgedPayload = Buffer.from(
      JSON.stringify({ email: "attacker@evil.com", issued: "2026-06-27" })
    ).toString("base64url");
    const tampered = `mcpl_${forgedPayload}.${key.split(".")[1]}`;
    expect(verifyKey(tampered, pubPem(publicKey))).toBeNull();
  });

  it("rejects a key signed by a different (unknown) private key", () => {
    const a = generateKeyPairSync("ed25519");
    const b = generateKeyPairSync("ed25519");
    const key = mint("dev@acme.com", a.privateKey);
    expect(verifyKey(key, pubPem(b.publicKey))).toBeNull();
  });

  it("rejects malformed keys without throwing", () => {
    for (const bad of ["", "nope", "mcpl_", "mcpl_.sig", "mcpl_abc", "mcpl_abc.", "not_mcpl_abc.def"]) {
      expect(verifyKey(bad)).toBeNull();
    }
  });

  it("a key not signed by the embedded production key is invalid by default", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const key = mint("dev@acme.com", privateKey);
    // default public key is the embedded one — a self-minted key must not pass
    expect(verifyKey(key)).toBeNull();
  });
});

describe("license — checkLicense / requirePro (no network, no key)", () => {
  it("no key → not Pro", async () => {
    delete process.env.MCPLINT_DEV;
    delete process.env.MCPLINT_LICENSE_KEY;
    const status = await checkLicense();
    expect(status.pro).toBe(false);
    expect(status.reason).toBe("no-key");
  });

  it("an invalid key → not Pro, and requirePro throws an actionable error", async () => {
    delete process.env.MCPLINT_DEV;
    process.env.MCPLINT_LICENSE_KEY = "mcpl_bogus.signature";
    const status = await checkLicense();
    expect(status.pro).toBe(false);
    expect(status.reason).toBe("invalid-key");
    await expect(requirePro("report export")).rejects.toThrow(/needs Pro/);
  });

  it("upgrade message tells the user how to activate", () => {
    expect(UPGRADE_MESSAGE).toContain("MCPLINT_LICENSE_KEY");
  });
});
