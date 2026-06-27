/** Pro licence check — the open-core gate, verified OFFLINE.
 *
 *  A licence key is a signed token:
 *      mcpl_<base64url(payload)>.<base64url(ed25519-signature)>
 *  mcplint verifies the signature against an embedded public key with no network
 *  call, so a paying user is never blocked by connectivity and no secret ever
 *  ships inside the CLI. The matching PRIVATE signing key lives only on the
 *  seller's machine (see scripts/issue-license.mjs) — it is never committed and
 *  never shipped. MCPLINT_DEV=1 unlocks Pro locally for dev/demos.
 *
 *  The key may come from MCPLINT_LICENSE_KEY or ~/.mcplint/config.json. */
import { promises as fs } from "node:fs";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".mcplint");
const CONFIG_FILE = join(DIR, "config.json");
const KEY_PREFIX = "mcpl_";

// Ed25519 public key (SPKI). The private half signs licences off-machine; this
// half only verifies them. Safe to be public — that's the point.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAsZOsje1nclJh/us+Wwentzk3DmfhHgwWmbtLDfN/0C8=
-----END PUBLIC KEY-----`;

export type LicenseReason = "dev-mode" | "valid" | "no-key" | "invalid-key";

export interface LicenseStatus {
  pro: boolean;
  reason: LicenseReason;
  detail?: string; // the licensed email, when valid
}

interface Payload {
  email: string;
  issued: string; // ISO date the licence was minted
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function getConfiguredKey(): Promise<string | null> {
  const env = process.env.MCPLINT_LICENSE_KEY;
  if (env) return env.trim();
  const config = await readJson<{ licenseKey?: string }>(CONFIG_FILE);
  return config?.licenseKey?.trim() ?? null;
}

/** Verify a signed licence key offline. Returns the payload when the signature
 *  is valid for the given public key (defaults to the embedded production key),
 *  else null. Never throws on malformed input. */
export function verifyKey(key: string, publicKeyPem: string = PUBLIC_KEY_PEM): Payload | null {
  try {
    if (!key.startsWith(KEY_PREFIX)) return null;
    const body = key.slice(KEY_PREFIX.length);
    const dot = body.indexOf(".");
    if (dot <= 0 || dot >= body.length - 1) return null; // need a non-empty payload AND signature
    const payloadSeg = body.slice(0, dot);
    const sig = Buffer.from(body.slice(dot + 1), "base64url");
    if (sig.length === 0) return null;
    // Ed25519: the algorithm argument is null. We sign/verify the payload
    // segment's exact bytes, so any tamper to the payload breaks the signature.
    const pub = createPublicKey(publicKeyPem);
    if (!edVerify(null, Buffer.from(payloadSeg), pub, sig)) return null;
    const payload = JSON.parse(Buffer.from(payloadSeg, "base64url").toString("utf8")) as Payload;
    if (!payload || typeof payload.email !== "string" || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function checkLicense(): Promise<LicenseStatus> {
  if (process.env.MCPLINT_DEV === "1") return { pro: true, reason: "dev-mode" };

  const key = await getConfiguredKey();
  if (!key) return { pro: false, reason: "no-key" };

  const payload = verifyKey(key);
  if (payload) return { pro: true, reason: "valid", detail: payload.email };
  return { pro: false, reason: "invalid-key" };
}

export const UPGRADE_MESSAGE = [
  "This is an mcplint Pro feature.",
  "Pro unlocks: shareable report export, watch mode, and the multi-server view.",
  "Get a licence (see the README), then set MCPLINT_LICENSE_KEY.",
].join("\n");

/** Throws a friendly, actionable error when Pro is required but missing. */
export async function requirePro(feature: string): Promise<void> {
  const status = await checkLicense();
  if (status.pro) return;
  const why =
    status.reason === "no-key" ? "No licence key found." : "Licence key is invalid.";
  throw new Error(`[mcplint] "${feature}" needs Pro. ${why}\n\n${UPGRADE_MESSAGE}`);
}
