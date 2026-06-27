#!/usr/bin/env node
/** Mint an mcplint Pro licence key for a customer.
 *
 *  SELLER-ONLY. This is never shipped to npm (package.json "files" lists only
 *  dist/README/LICENSE) and the private key it needs is never committed. The
 *  public half is embedded in src/pro/license.ts, which verifies these keys
 *  offline.
 *
 *  Usage (point it at your private signing key):
 *      MCPLINT_SIGNING_KEY_FILE="C:/Users/fletc/secrets/mcplint-signing-key.pem" \
 *          node scripts/issue-license.mjs customer@example.com
 *
 *  Or pass the PEM contents directly via MCPLINT_SIGNING_KEY.
 *  Prints the licence key (mcpl_…) to stdout — email it to the customer. */
import { readFileSync } from "node:fs";
import { createPrivateKey, sign as edSign } from "node:crypto";

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("usage: node scripts/issue-license.mjs <customer-email>");
  process.exit(1);
}

const pem =
  process.env.MCPLINT_SIGNING_KEY ??
  (process.env.MCPLINT_SIGNING_KEY_FILE
    ? readFileSync(process.env.MCPLINT_SIGNING_KEY_FILE, "utf8")
    : null);

if (!pem) {
  console.error(
    "Set MCPLINT_SIGNING_KEY_FILE (path to the PEM) or MCPLINT_SIGNING_KEY (PEM contents)."
  );
  process.exit(1);
}

const priv = createPrivateKey(pem);
const payload = { email, issued: new Date().toISOString().slice(0, 10) };
const payloadSeg = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = edSign(null, Buffer.from(payloadSeg), priv).toString("base64url");

console.log(`mcpl_${payloadSeg}.${sig}`);
