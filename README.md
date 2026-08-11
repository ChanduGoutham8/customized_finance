# Ledger

A private, installable ledger PWA: track money you've lent or borrowed (People),
your own cash/bank/card balances (Wallet), and daily brokerage balances for
investment platforms like Groww or Upstox (Investments). See [FEATURES.md](FEATURES.md)
for the full behavioural spec — treat it as the source of truth.

No build step. No shared backend — everything lives in **your own** Firebase project.

## Setup

> **Want this automated?** [CHROME_SETUP.md](CHROME_SETUP.md) has a ready-to-paste
> prompt for the Claude in Chrome browser extension that walks through steps 1–3
> below using your logged-in Google session, and shows you the config to paste into
> step 2.

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) and create a project.
2. **Build → Authentication → Sign-in method** → enable **Email/Password**.
3. **Build → Firestore Database** → create a database (start in production mode).
4. **Project settings → General → Your apps** → add a **Web app**. Copy the config object it gives you.

### 2. Wire up your config

Paste your web app's config into [js/config.js](js/config.js):

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

These are public client identifiers, not secrets — Firestore security rules are what
actually protect your data (see below). Safe to commit.

### 3. Deploy the security rules

Copy the contents of [firestore.rules](firestore.rules) into **Firestore Database →
Rules** in the console (or deploy via the Firebase CLI: `firebase deploy --only
firestore:rules`). Without this, the database is either wide open or fully locked,
depending on the mode you picked when creating it.

### 4. Run it

There's no build step — this is plain HTML/CSS/JS. Serve the folder with any static
file server, for example:

```bash
npx serve .
```

or Python's built-in server:

```bash
python -m http.server 8080
```

Open the served URL, create an account (email/password), and start adding people,
accounts, and investment platforms.

### 5. Install as an app (optional)

Once served over HTTPS (or `localhost`), your browser will offer to install it as a
PWA — standalone window, offline app shell, home-screen icon.

## Project structure

See the [File map](FEATURES.md#30-file-map) in FEATURES.md.

## Investments (Groww / Upstox) — how profit/loss works

Each investment platform (Groww, Upstox, or anything else you add) tracks a simple
daily balance: whatever the platform says your holdings are worth today. There's no
separate deposit/withdrawal ledger — you just log the number.

Profit/loss for an entry is **that balance minus the previous recorded balance**
(not necessarily the day before — the last time you logged one). Positive = gain
(green), negative = loss (red). Skip a few days and log again — the whole gap's
movement lands on that next entry.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch/commit conventions and the release
checklist (bumping the service worker cache version, etc). [CLAUDE.md](CLAUDE.md) has
project-specific instructions if you're using Claude Code (CLI or VS Code extension)
to work on this repo.
