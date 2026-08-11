# Contributing

## Ground rules

- [FEATURES.md](FEATURES.md) is the source of truth. If a change would contradict it,
  update the doc in the same commit.
- No build step, no framework, no bundler. Plain ES modules + Firebase from CDN.
  The dev loop is: edit a file, reload the page.
- Keep currencies separate everywhere. Never sum EUR and INR into one figure.
- Keep the three layers (People/Loans, Wallet, Investments) separate. No merged
  net-worth number.

## Local run

```bash
npx serve .
# or: python -m http.server 8080
```

You'll need your own Firebase project wired up in `js/config.js` — see the Setup
section of [README.md](README.md).

## Branching & commits

- Branch per feature/fix: `feature/<name>` or `fix/<name>`.
- Commit messages: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`.
- Update `FEATURES.md` in the same commit as any behavioural change.

## Release checklist

Whenever any app file changes (`index.html`, `css/`, `js/`, `manifest.webmanifest`):

1. Bump the `CACHE` version string at the top of [sw.js](sw.js) — otherwise
   installed users keep serving the old cached shell.
2. Confirm the app still works fully offline after a hard reload (airplane mode +
   reload should still show the shell and cached data).
3. Re-read [FEATURES.md](FEATURES.md) section 26 (edge cases) if you touched loan,
   card, or investment math — those calculations have specific, tested rules.

## Picking up a roadmap item

See [FEATURES.md § Roadmap](FEATURES.md#31-roadmap--open-items). Branch, implement,
update the spec doc if behaviour changes, commit, bump the service worker cache.
