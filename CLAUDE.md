# CLAUDE.md

Instructions for Claude Code (CLI or VS Code extension) working in this repo.

## What this project is

A private ledger PWA — vanilla JS, no framework, no build step, Firebase (Auth +
Firestore) as the only backend. **[FEATURES.md](FEATURES.md) is the source of truth**
for behavior. Read it before making any feature change. If a change would contradict
something written there, update FEATURES.md in the same commit — don't let the doc
drift from reality.

## Non-negotiable rules (see FEATURES.md §1 for the full list)

- Currencies (EUR/INR) are **never** summed together. Every total is per-currency.
- The three layers — People/Loans, Wallet (cash/bank/card), Investments — are never
  merged into one net-worth number.
- No auto-linking between layers (e.g. a loan payment never touches an account balance).
- No build step. This is plain `<script type="module">` + Firebase imported directly
  from `https://www.gstatic.com/firebasejs/...` CDN URLs. Don't introduce npm,
  webpack/vite, TypeScript, or a framework — that would break the "edit and reload"
  dev loop this app is built around.
- Soft-delete first: people, loan entries, accounts, and investment platforms go to
  Trash before permanent removal. Only account ledger entries and investment balance
  entries are hard-deleted immediately.

## Architecture quick reference

- `js/app.js` is the entire application (state, router, Firebase sync, every view,
  every action) — see FEATURES.md §2 for the rendering model.
- Views are functions returning HTML strings; the router swaps `#root`'s innerHTML.
- All click/input/change handling is delegated through `data-action` attributes to a
  shared `actions` object. **These delegated listeners are attached exactly once, at
  boot, directly on the persistent `#root` and `#sheet-root` elements** — not inside
  the render function. This was a real bug caught during the initial build: attaching
  them per-render stacks duplicate listeners on the (never-replaced) container element,
  so every click fires N times after N re-renders. If you add a new kind of event
  delegation, attach it once at module load, not inside `renderCurrent()` or any view
  function.
- Firestore sync uses `collectionGroup` queries (`txns`, `entries`, `balances`) rather
  than per-parent listeners — simpler fan-out for a single-user app. Each of those
  three document types carries a `uid` field, and each query has a matching
  `where("uid", "==", uid)` clause — both are required together for Firestore to
  authorize the query at all (a path-based `/users/{uid}/**` rule alone can't cover a
  collection-group query, since it isn't scoped by parent path; see FEATURES.md §4 for
  the full explanation). Don't remove the `where` clause or the `uid` field without
  replacing this mechanism entirely.
- State lives in the single `S` object. Any `onSnapshot` callback updates `S` and calls
  `renderCurrent()` — there's no separate "dirty" tracking.

## Running locally

No build step — just serve the static files and open it:

```bash
npx serve .
# or
python -m http.server 8081
```

You need a real Firebase project wired into `js/config.js` for auth/data to actually
work (see README.md § Setup). Without it, the UI renders fine but sign-in fails with
`auth/api-key-not-valid` — that's expected, not a bug, until real keys are in place.

## Before committing a behavior change

1. Check it against FEATURES.md — update the doc if behavior changed.
2. If you touched `index.html`, `css/`, `js/`, or `manifest.webmanifest`, bump the
   `CACHE` version string in `sw.js` (see CONTRIBUTING.md § Release checklist) or
   installed users keep serving stale cached files.
3. Re-verify currency separation and layer separation weren't accidentally broken —
   these are the two rules most likely to regress silently.
