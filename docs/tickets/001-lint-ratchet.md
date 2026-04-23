# 001 — Lint ratchet: remove `ignoreDuringBuilds` from next.config.ts

**Milestone:** M1 — Test ratchet + lint ratchet
**Target date:** 2026-05-07

## Problem

`next.config.ts` currently has `eslint.ignoreDuringBuilds: true`, added in commit `f4e5ff4` to unblock the first lint-enabled push. Root cause: repo has ~20 preexisting ESLint errors and warnings from before any config existed. `next/core-web-vitals` ruleset exposed them all at once.

Specific offenders (from CI log on 2026-04-23):
- `src/app/connect/page.tsx` — 3 errors (`no-html-link-for-pages` x2, `no-unescaped-entities` x2), 2 warnings
- `src/lib/pipeline/orchestrator.ts` — 2 errors (`no-explicit-any` x2), 1 warning
- `src/lib/pipeline/test-runner.ts` — 1 error (`no-explicit-any`)
- `src/lib/whatsapp-baileys.ts` — 1 error (`rules-of-hooks` on `useMultiFileAuthState`)
- `src/lib/whatsapp-manager.ts` — 1 error (`no-explicit-any`), 1 warning
- `src/scraper/whatsapp-client.ts` — 2 errors (`no-explicit-any` x2)
- plus ~5 warnings across `src/app/api/whatsapp/send-report/route.ts`, `src/app/page.tsx`, `src/middleware.ts`

## Success criterion

1. `npm run lint` exits 0 from a clean checkout
2. `next.config.ts` does not contain `ignoreDuringBuilds`
3. `.github/workflows/ci.yml` ESLint step has `continue-on-error: false` (or the line removed)
4. `act pull_request -j check -j build` green

## Out of scope

- Rule tuning (adding `rules: {}` to disable rules) — if a rule is wrong for this repo, document why in PR body, then disable surgically. Do not bulk-disable.
- Converting `any` to proper types in orchestrator — this ticket is about passing lint. If types need invention, scope them into a separate ticket.
- Prettier/formatting. Out of scope; separate concern.

## Edge cases

- `useMultiFileAuthState` is Baileys's own hook-named function, not React. `rules-of-hooks` misfires here. Use file-level eslint-disable with a comment citing the Baileys API.
- `<a href="/">` in `connect/page.tsx` may be intentional (full reload to clear auth state). If so, disable the rule at the line with a comment explaining. Otherwise swap to `<Link>`.
- Tests in `tests/` directory are ignored in eslint.config.mjs — don't accidentally remove that ignore.

## Verification

```bash
act pull_request -W .github/workflows/ci.yml -j check -j build
```

Expect all steps green including `ESLint` (no longer continue-on-error).
