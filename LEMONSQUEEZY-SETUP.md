# mcplint Pro — go-live setup (LemonSqueezy)

The Pro code is **done and wired to LemonSqueezy's real licence API** already
(`src/pro/license.ts` → `validateLemonSqueezy`). There is nothing left to build.
Going live is an account + one-link job. This is the runbook.

> Time: ~30–60 min of your clicking, plus however long LemonSqueezy takes to
> approve your payout/identity (often same-day). No further code from me beyond
> the one-line link edit at the end (already staged as a placeholder).

## What Pro unlocks (already gated in code)
- `--report` (Markdown) and `--report --format html` (standalone HTML report)
- `--watch` (re-lint on save / on a timer)
- multi-source view (several files / a live server in one pass)

Free stays free forever: `lint`, `score`, `--json`, `--ci`, single live `--cmd`.

## Price (set cheap, per Tom — change anytime in 30s)
- **Configured target: £5/month subscription.** Cheap, recurring (matches the
  portfolio's recurring thesis), low enough to be an impulse for a working dev.
- One-off alternative if you'd rather not bill devs monthly for a linter: a
  **one-time licence at ~£15** also produces a licence key the code validates —
  LemonSqueezy supports both. Pick monthly OR one-time; the code handles either.

## Your steps (LemonSqueezy dashboard)
1. **Create the account / store** at lemonsqueezy.com. They are the
   merchant-of-record → they collect & remit VAT/sales tax for you (the reason
   we use them over raw Stripe for a solo operator).
2. Complete **payout + tax details** (this is the part that can gate go-live).
3. **New Product** →
   - Name: `mcplint Pro`
   - Description: "Pro features for mcplint — shareable Markdown/HTML reports,
     watch mode, and multi-source linting. For the free CLI: `npm i -g
     @tomfletcher2929/mcplint`."
   - Pricing: **£5 / month** (or one-time £15 — your call).
4. **Turn ON "Generate license keys"** for the product (Settings → License keys
   → enable). This is the load-bearing toggle — the CLI validates these keys.
   - Activation limit: leave default (or set 3–5 machines per key).
5. Publish the product. Copy its **public checkout/product URL** (looks like
   `https://<yourstore>.lemonsqueezy.com/buy/<uuid>`).

## The one edit at go-live (then we're done)
Paste that checkout URL in **two** places (both currently carry a clearly-marked
placeholder so nothing ships broken before then):
1. `README.md` → the `## Pro` section link (`LEMONSQUEEZY_STORE_URL`).
2. *(optional)* `src/pro/license.ts` → add the direct link line to
   `UPGRADE_MESSAGE` (it currently points users to the README, which is fine).

Then republish the package so installed users see the link:
```bash
npm version patch        # 0.1.1 -> 0.1.2
npm run lint && npm test && npm run build
npm publish --access public
```

## End-to-end test before you announce it (5 min)
1. In LemonSqueezy, make a **test-mode** purchase (or generate a key) to get a
   real licence key.
2. Verify the gate actually unlocks:
```bash
export MCPLINT_LICENSE_KEY=<the-key>
node dist/cli.js examples/sample-tools.json --report        # should now WRITE a report, not refuse
unset MCPLINT_LICENSE_KEY
node dist/cli.js examples/sample-tools.json --report        # should refuse with the friendly upgrade message
```
If the first writes a report and the second shows the upgrade message, Pro works.

## Notes
- `MCPLINT_DEV=1` bypasses the gate locally — never set it in anything you ship.
- 14-day offline grace is built in: a paying user who goes offline keeps Pro for
  14 days, then is asked to revalidate (never hard-locked mid-flight).
- Provider is hardcoded to LemonSqueezy today; a Gumroad switch
  (`MCPLINT_LICENSE_PROVIDER`) is a future option, not needed for launch.
</content>
</invoke>
