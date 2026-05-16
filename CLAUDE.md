# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Keep this file up to date at all times.** Whenever the codebase changes in a meaningful way — new features, architectural decisions, changed commands, new dependencies — update this file to reflect the current state.

## Running the App

**Frontend only (port 8080):**
```bash
python3 start_server.py
```

**Full stack with Cloudflare Pages Functions (port 8788):**
```bash
npm run dev   # wrangler pages dev
```
Copy `.dev.vars.example` → `.dev.vars` and fill in secrets before running wrangler.

**Run Playwright tests:**
```bash
npm test
# For subscription tests (requires wrangler running + SUBSCRIPTION_TEST_MODE=true in .dev.vars):
npx playwright test tests/abonnement.spec.ts
```

## Architecture

This is a single-file SPA (`norsk_b2_pro.html`) for Norwegian B2 language learning. All HTML, CSS, and JS are inline in that one file. No framework, no bundler, no external JS dependencies.

**Backends:**
- **FastAPI** (`http://localhost:8000`) — auth (JWT), words, sentences, essays, stats, plan
- **Cloudflare Pages Functions** (`functions/api/[[route]].ts`) — subscription management (KV storage), Vipps/PayPal webhooks, Claude proxy

**State** is a single `state` object in memory + `localStorage`:
- `b2_session_token` — JWT from FastAPI auth
- `b2_user_id` / `b2_user_name` / `b2_user_email` — user identity
- `b2_free_access_{userId}` — free tier text tracking `{ openedTexts[], topicsUsed[] }`
- `state.subscription` — loaded from `/api/subscription/{userId}` after login

**UI rendering** uses a custom `el(tag, props, ...children)` helper. Re-renders by calling `renderContent()`.

**Tabs / features:**
- `ordbank` — vocabulary bank (add, search, filter, import/export)
- `lesing` — reading texts with subscription access control + paywall overlay
- `setninger` — sentence practice
- `flashcards` — quiz modes
- `setningsbygging` — word-sort game
- `oppgaver` — essay prompts
- `skriv` — essay editor with Claude grammar feedback
- `plan` — study plan (unlocks texts in Lesing tab)
- `statistikk` — learning statistics
- `innstillinger` — profile, subscription management (upgrade/cancel)

**Subscription access logic:**
- `isActiveSubscriber()` — returns true if `state.subscription.status` is active/grace/cancelled-but-not-expired
- `canOpenText(textId, topicKey)` — returns true for subscribers; for free users: max 3 texts, 1 per topic
- `recordTextOpened(textId, topicKey)` — persists free-tier usage to localStorage

**Cloudflare Functions structure:**
```
functions/api/
├── [[route]].ts          # Main router + Env interface
├── handlers/
│   ├── subscription.ts   # GET/POST /api/subscribe, GET/POST /api/subscription/*
│   ├── webhook-vipps.ts  # POST /api/webhook/vipps
│   ├── webhook-paypal.ts # POST /api/webhook/paypal
│   └── test-simulate.ts  # POST /api/test/simulate-renewal (test mode only)
└── lib/
    ├── subscription-kv.ts # KV read/write helpers
    ├── crypto.ts          # HMAC-SHA256 verification (Web Crypto API)
    ├── idempotency.ts     # Webhook deduplication (30-day TTL)
    ├── vipps.ts           # Vipps Recurring API v3 client
    └── paypal.ts          # PayPal Subscriptions API v2 client
```

**Subscription test flow (without real payments):**
```bash
# Set SUBSCRIPTION_TEST_MODE=true in .dev.vars, then:
curl -X POST http://localhost:8788/api/test/simulate-renewal \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","outcome":"success"}'
```

**External APIs used:**
- FastAPI backend (`http://localhost:8000`) — auth + user data
- MyMemory (`api.mymemory.translated.net`) — translation lookups
- Claude API — grammar feedback (proxied via Cloudflare function)
- Bokmålsordboka (`ordbokene.no`) — dictionary deep links
- Vipps Recurring API v3 — Norwegian payment subscriptions
- PayPal Subscriptions API v2 — international payment subscriptions

## Key Files

| File | Purpose |
|------|---------|
| `norsk_b2_pro.html` | The entire frontend application |
| `start_server.py` | Local HTTP server (port 8080) |
| `wrangler.toml` | Cloudflare Pages config + KV binding |
| `.dev.vars.example` | Template for local secrets (copy to `.dev.vars`) |
| `tsconfig.json` | TypeScript config for `functions/` |
| `functions/api/[[route]].ts` | Cloudflare Pages Function router |
| `tests/abonnement.spec.ts` | Playwright E2E tests for subscription flows |
| `ordbank-2-med-emner.json` | Sample word bank for import testing |
