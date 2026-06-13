/** Pro licence check — the open-core gate. Mirrors the proven a11ygent pattern:
 *  the key comes from env or ~/.mcplint/config.json, successful validations are
 *  cached with a 14-day offline grace so paying users are never blocked by a
 *  flaky network, and MCPLINT_DEV=1 unlocks Pro locally for dev/demos.
 *
 *  ENHANCED-TODO: the store provider is hardcoded to LemonSqueezy. The a11ygent
 *  house pattern makes it a config switch (A11YGENT_LICENSE_PROVIDER); add a
 *  MCPLINT_LICENSE_PROVIDER + Gumroad path before a second store goes live. */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GRACE_DAYS = 14;
const DIR = join(homedir(), ".mcplint");
const CACHE_FILE = join(DIR, "license.json");
const CONFIG_FILE = join(DIR, "config.json");

export type LicenseReason =
  | "dev-mode"
  | "validated-online"
  | "offline-grace"
  | "no-key"
  | "invalid-key"
  | "expired-grace"
  | "provider-error";

export interface LicenseStatus {
  pro: boolean;
  reason: LicenseReason;
  detail?: string;
}

interface Cache {
  key: string;
  lastValidated: string; // ISO
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
  if (env) return env;
  const config = await readJson<{ licenseKey?: string }>(CONFIG_FILE);
  return config?.licenseKey ?? null;
}

async function validateLemonSqueezy(key: string): Promise<boolean> {
  const res = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ license_key: key }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { valid?: boolean; license_key?: { status?: string } };
  // `valid` is the provider's own validity flag; additionally reject explicitly
  // revoked statuses as defense in depth. A missing status with valid:true is
  // honoured — never lock a paying user out over an unexpected response shape.
  const status = data.license_key?.status;
  return Boolean(data.valid) && status !== "inactive" && status !== "expired" && status !== "disabled";
}

function withinGrace(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < GRACE_DAYS * 86_400_000;
}

export async function checkLicense(): Promise<LicenseStatus> {
  if (process.env.MCPLINT_DEV === "1") return { pro: true, reason: "dev-mode" };

  const key = await getConfiguredKey();
  if (!key) return { pro: false, reason: "no-key" };

  const cache = await readJson<Cache>(CACHE_FILE);
  try {
    if (await validateLemonSqueezy(key)) {
      await fs.mkdir(DIR, { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify({ key, lastValidated: new Date().toISOString() }), "utf8");
      return { pro: true, reason: "validated-online" };
    }
    return { pro: false, reason: "invalid-key" };
  } catch (err) {
    // Network problem — honour the offline grace window for known-good keys.
    if (cache?.key === key && withinGrace(cache.lastValidated)) return { pro: true, reason: "offline-grace" };
    if (cache?.key === key) return { pro: false, reason: "expired-grace", detail: `offline more than ${GRACE_DAYS} days` };
    return { pro: false, reason: "provider-error", detail: err instanceof Error ? err.message : String(err) };
  }
}

export const UPGRADE_MESSAGE = [
  "This is an mcplint Pro feature.",
  "Pro unlocks: shareable report export and watch mode.",
  "Get a licence (see the README), then set MCPLINT_LICENSE_KEY.",
].join("\n");

/** Throws a friendly, actionable error when Pro is required but missing. */
export async function requirePro(feature: string): Promise<void> {
  const status = await checkLicense();
  if (status.pro) return;
  const why =
    status.reason === "no-key"
      ? "No licence key found."
      : `Licence check failed (${status.reason}${status.detail ? `: ${status.detail}` : ""}).`;
  throw new Error(`[mcplint] "${feature}" needs Pro. ${why}\n\n${UPGRADE_MESSAGE}`);
}
