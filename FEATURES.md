# Ledger — Complete Feature Specification

> Single source of truth for the **Ledger** app. Hand this to Claude Code (or any
> contributor) as the definitive description of what exists and how it must behave.
> If a change would contradict a rule here, update this file in the same commit.

**What it is:** a private, installable web app (PWA) with three independent layers:

1. **People / Loans (IOUs)** — money you have lent to or borrowed from other people.
2. **Wallet** — your own money: cash, bank accounts, and credit cards.
3. **Investments (Stocks)** — daily balance snapshots for brokerage platforms (e.g. Groww, Upstox), tracked as part of the Wallet layer.

The layers are **never merged into a single number**. Each is tracked and totalled on its own.

Alongside the three layers there's also **Notes** — a flat, un-tracked log for anything
that doesn't fit any of them: a transfer to family, a cash spend while travelling,
anything you just want to remember happened. No balance, no direction, no account or
person to set up first. See §29.

---

## Table of contents

1. [Core principles (non-negotiable rules)](#1-core-principles)
2. [Tech stack & architecture](#2-tech-stack--architecture)
3. [Design system](#3-design-system)
4. [Data model (Firestore)](#4-data-model-firestore)
5. [Navigation & routes](#5-navigation--routes)
6. [Authentication](#6-authentication)
7. [PIN app-lock](#7-pin-app-lock)
8. [People management](#8-people-management)
9. [Loan entries (lent / borrowed)](#9-loan-entries)
10. [Partial payments](#10-partial-payments)
11. [Loan detail, history & audit log](#11-loan-detail-history--audit-log)
12. [Dashboard (Home)](#12-dashboard-home)
13. [Wallet overview](#13-wallet-overview)
14. [Cash & bank accounts](#14-cash--bank-accounts)
15. [Account transaction ledger](#15-account-transaction-ledger)
16. [Credit cards](#16-credit-cards)
17. [Investments (Stocks)](#17-investments-stocks)
18. [Reminders](#18-reminders)
19. [Trash & auto-purge](#19-trash--auto-purge)
20. [Reports & exports](#20-reports--exports)
21. [Backup & restore](#21-backup--restore)
22. [Settings](#22-settings)
23. [Theming](#23-theming)
24. [PWA & offline](#24-pwa--offline)
25. [Currency rules](#25-currency-rules)
26. [Edge cases & business rules](#26-edge-cases--business-rules)
27. [Known limitations / non-goals](#27-known-limitations--non-goals)
28. [Roadmap / open items](#28-roadmap--open-items)
29. [Notes (quick log)](#29-notes-quick-log)
30. [File map](#30-file-map)

---

## 1. Core principles

These are the rules the whole app is built around. Do not break them.

- **Currencies never mix.** EUR (€) and INR (₹) are always shown and totalled separately. There is never a single figure that adds euros and rupees together.
- **Accounts, people-loans, and investments stay separate.** No combined "net worth." Wallet totals, loan totals, and investment totals are shown in their own sections.
- **No auto-linking.** Lending money, receiving a repayment, or an investment balance changing does **not** automatically change any other balance. The user updates each one themselves.
- **Data ownership.** All data lives in the user's own Firebase/Firestore project. There is no shared backend and no server the developer controls.
- **No build step.** Plain HTML/CSS/JS + Firebase from CDN. Editing a file and reloading is the entire dev loop.
- **Soft-delete first.** People, loan entries, accounts, and investment platforms go to Trash (recoverable) before being permanently removed after a retention window.

---

## 2. Tech stack & architecture

- **Frontend:** vanilla JavaScript (ES modules), single-page app, hash-based router. No framework, no bundler.
- **Backend:** Firebase (the user's own project):
  - **Auth** — email/password.
  - **Firestore** — all data, one document tree per user, with offline persistence (`persistentLocalCache` + multi-tab manager).
- **Firebase SDK:** v10 modular, imported from `https://www.gstatic.com/firebasejs/10.12.5/…`.
- **Lazy-loaded libraries (from cdnjs, only when exporting):**
  - SheetJS (`xlsx`) for Excel export.
  - jsPDF for PDF export.
- **Fonts:** Google Fonts — Space Grotesk (numbers/display), Inter (body).
- **Rendering model:** each view is a function returning an HTML string; the router writes it into `#root` and wires event listeners. State lives in a single in-memory object `S`, kept in sync by Firestore `onSnapshot` listeners; any snapshot change re-renders the current view. Click/input/change handling is delegated once to the persistent `#root`/`#sheet-root` containers (attaching per-render would stack duplicate listeners), dispatched via `data-action` attributes to a shared `actions` registry.

---

## 3. Design system

**Identity:** ink-on-paper ledger. Brass accent. The signature is **money direction** — the colour and sign of a balance tell you instantly who owes whom.

**Colours (design tokens):**

| Token | Hex | Meaning |
|-------|-----|---------|
| `--brass` | `#C8901E` | primary accent |
| `--credit` | `#2F7D5B` | green — they owe you / money in / credit available / investment gain |
| `--debit` | `#C0533F` | red — you owe / money out / card debt / investment loss |
| `--settled` | `#8A8578` | gray — settled / zero |
| dark bg | `#12100E` | default background |
| light bg | `#FAF7F0` | light background |

- **Themes:** dark (default) and light, switched via `[data-theme]` on `<html>`.
- **Typography:** Space Grotesk for all numerals and headings (tabular figures), Inter for body text.
- **Components:** sticky top bar, 5-item bottom tab bar with badges, cards, list rows, credit-card tiles, bottom-sheet modals, a floating "Add" button (FAB), toasts (some with an Undo action), progress bars, pin pad, empty states, spinner.
- **Account-type accent colours:** cash = green tint, bank = blue tint, card = red tint.

---

## 4. Data model (Firestore)

All data is under `users/{uid}/`. Timestamps are stored as millisecond numbers (`Date.now()`) unless noted; `dueDate` and investment balance `date` are ISO date strings (`YYYY-MM-DD`).

```
users/{uid}/
  settings/app                     (single document)
    { theme, pinHash, defaultCurrency, purgeDays }

  people/{personId}
    { name, tags[], note, contact, createdAt, deletedAt }

    people/{personId}/txns/{txnId}
      {
        type: "lent" | "borrowed",
        currency: "EUR" | "INR",
        principal: number,
        description: string,
        createdAt: number,          // editable date-time
        dueDate: "YYYY-MM-DD" | null,
        status: "open" | "settled",
        payments: [ { id, amount, at, note } ],
        history:  [ { at, text } ],  // audit log
        deletedAt: number | null,
        uid: string                 // == the owning user's uid; see note below
      }

  accounts/{accountId}
    {
      kind: "cash" | "bank" | "card",
      name: string,
      bank: string,                 // issuer / bank name (blank for cash)
      currency: "EUR" | "INR",
      opening: number,              // opening balance (cash/bank) OR starting outstanding (card)
      limit: number | null,         // card only
      dueDay: number | null,        // card only, 1–28
      statementDay: number | null,  // card only, reserved (not yet surfaced in UI)
      note: string,
      createdAt: number,
      deletedAt: number | null
    }

    accounts/{accountId}/entries/{entryId}
      {
        type: "deposit" | "expense"   // cash & bank
             | "charge"  | "payment", // card
        amount: number,
        description: string,
        category: string,             // cash/bank only; from a preset list
        at: number,                   // editable date-time
        createdAt: number,
        uid: string                   // == the owning user's uid; see note below
      }

  investments/{investmentId}
    {
      name: string,                  // e.g. "Groww", "Upstox", or any platform
      currency: "EUR" | "INR",
      note: string,
      createdAt: number,
      deletedAt: number | null
    }

    investments/{investmentId}/balances/{balanceId}
      {
        date: "YYYY-MM-DD",          // one snapshot per day (re-saving the same date updates it)
        amount: number,              // account value as of that date
        createdAt: number,
        uid: string                  // == the owning user's uid; see note below
      }

  notes/{noteId}
    {
      note: string,                  // required — what this was
      amount: number,
      currency: "EUR" | "INR",
      at: number,                    // editable date-time
      createdAt: number
    }
```

**Why `txns`/`entries`/`balances` carry a `uid` field:** the app syncs each of these
three subcollection types with a single `collectionGroup` listener (all loan entries
across every person, in one query) rather than one listener per parent. Firestore
can't authorize a collection-group *query* using a path-based rule — the query isn't
scoped by parent path, so the rule can't prove every possible match belongs to the
requesting user. Storing the owner's uid directly on the document, writing a rule
that checks `resource.data.uid`, **and** adding a matching `where("uid", "==", uid)`
clause to the client query itself is the standard way around that (see the two-rule
setup below) — Firestore rejects a collection-group query outright, even with a
correct `resource.data` rule, unless the query's own filters let it statically prove
every possible match satisfies the rule. Writes still go through the normal
per-parent path and are authorized by the path-based rule regardless.

**Firestore security rules** (locks every user to their own tree — covers all of the above via the wildcard; see `firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /{path=**}/txns/{txnId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }
    match /{path=**}/entries/{entryId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }
    match /{path=**}/balances/{balanceId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }
  }
}
```

---

## 5. Navigation & routes

Hash-based router. Bottom tab bar shows 5 destinations: **Home, People, Wallet, Reports, Settings**. (Trash is reached from Settings, not the tab bar. Investments are reached from Wallet, not the tab bar. Notes are reached from Home, not the tab bar.)

| Route | View | In tab bar? |
|-------|------|-------------|
| `#/` | Dashboard / Home | ✔ |
| `#/people` | People list | ✔ |
| `#/person/{pid}` | Person detail | back button |
| `#/txn/{pid}/{tid}` | Loan (transaction) detail | back button |
| `#/wallet` | Wallet overview | ✔ |
| `#/account/{aid}` | Account detail | back button |
| `#/investment/{iid}` | Investment platform detail | back button |
| `#/notes` | Notes (quick log) | back button (opened from Home) |
| `#/reports` | Reports & exports | ✔ |
| `#/trash` | Trash | back button (opened from Settings) |
| `#/settings` | Settings | ✔ |

**Tab badges:**
- Home: number of overdue loan entries.
- Wallet: number of credit cards with a repayment due within 5 days.

**FAB "Add" (on Home)** opens a quick-add chooser: Quick note · New person · New account/card · New investment platform · Loan entry for {an existing person}.
**FAB "Add" (on Wallet)** opens a chooser scoped to Wallet: cash account · bank account · credit card · investment platform.

---

## 6. Authentication

- Firebase **email/password**.
- Screens: **Sign in**, **Create account**, **Forgot password** (sends reset email).
- Switch between sign-in and sign-up inline.
- Friendly, specific error messages (wrong password, email in use, weak password, network error, etc.).
- The same login on any device shows the same data (cross-device sync).
- Signing out returns to the login screen and tears down all listeners.

---

## 7. PIN app-lock

- **Optional** 4-digit PIN, set in Settings.
- Stored as a **SHA-256 hash** in `settings/app.pinHash` (never plain text).
- When enabled, a lock screen with a pin pad appears **after login, before the app**.
- Unlock lasts for the session; the app re-locks on reload.
- Setting a PIN requires entering it, then confirming it.
- Turning it off asks for confirmation.
- It is a convenience lock on top of the account password, not a replacement.

---

## 8. People management

- **Add person:** name (required), contact (optional — phone/email), tags (multi-select from **Family, Friends, Work, Neighbour**), note (optional).
- **Edit person:** all of the above.
- **Delete:** soft-delete to Trash, with an **Undo** toast.
- **Restore** from Trash; **auto-purge** after the retention window.
- **Search** people by name (live).
- **Filter** by tag.
- **Sort** by: balance (largest absolute net first), A–Z (name), Newest (creation date).
- **Avatar:** initials derived from the name.
- **Colour coding** on each row: green (net = they owe you), red (net = you owe), gray (settled/zero).
- **Row content:** name, one tag, a direction dot + label ("owes you" / "you owe" / "settled"), the **primary balance** (the currency with the largest absolute net), and a `+N ccy` hint when the person has balances in more than one currency.

---

## 9. Loan entries

Each loan entry ("txn") belongs to a person.

- **Type:** `lent` (they owe you) or `borrowed` (you owe them), chosen with a two-option toggle.
- **Currency:** EUR or INR, per entry.
- **Amount (principal):** required, > 0.
- **Description:** optional.
- **Date & time:** defaults to now, **editable**.
- **Due date:** optional.
- **Status:** `open` or `settled`.
- **Create** via the person detail screen ("I lent" / "I borrowed" buttons) or via quick-add.
- Green/red styling follows the type.

---

## 10. Partial payments

Repayments are recorded against a single loan entry.

- A **slider** from 0 to the remaining amount, with a live amount label.
- **"Pay full"** shortcut prefills the full remaining amount.
- **Record payment** sheet: amount (capped at remaining in the slider) + optional note.
- Each payment is appended to `payments[]` as `{ id, amount, at, note }`.
- **Remaining** = `principal − sum(payments)`.
- **Auto-settle:** when a payment brings remaining to `≤ 0`, the entry is marked `settled` automatically.
- **Overpayment:** if remaining goes below 0, the detail screen shows **"Overpaid by X"**.
- A **progress bar** shows `paid / principal`.

---

## 11. Loan detail, history & audit log

- **Header:** remaining amount (coloured by direction), "paid X of Y", description, start date-time, due date.
- **Payment slider** (shown while open and remaining > 0).
- **Mark settled / Reopen** toggle.
- **History timeline** (newest first): the original amount plus every payment, each with date-time and any note.
- **Audit log:** `history[]` records every creation, payment, edit, settle/reopen with a timestamp. **Edits keep the old values** by describing the change (e.g. "amount €50 → €60").
- **Edit entry:** description, principal, currency, due date. Every edit is written to the audit log.
- **Move entry to Trash** (with Undo).
- **Per-person statement PDF** export (from the person detail screen).

---

## 12. Dashboard (Home)

- **Owed to you** — totals per currency.
- **You owe** — totals per currency.
- **Net position** — per currency, coloured; shows "All settled" when zero. Explicit note that currencies are never added together.
- **Needs attention** (up to 6): overdue entries, then stale ones (open, remaining > 0, no activity for 30+ days). Each row taps through to the loan.
- **Top balances:** the 5 people with the largest absolute net.
- **"Your money" strip:** a compact, clearly-separate card showing cash+bank on hand per currency and a "N card repayments due soon" note, linking to Wallet. It **does not** merge wallet and loan figures.
- **Notes strip:** the 5 most recent quick-log notes, a "+ Quick note" button, and a link to the full list (`#/notes`) once any exist.
- **FAB** quick-add.
- Empty state prompts adding the first person.

---

## 13. Wallet overview

The Wallet tab is the home of the user's own money: cash, bank, cards, and investments.

- **Money on hand:** cash + bank balances, per currency (kept separate).
- **Card debt** and **Available credit:** per currency, shown when any cards exist.
- **Repayments due:** cards with outstanding balances, sorted by soonest due date, each showing amount and due date; flagged when within 5 days.
- **Groups:** Cash accounts, Bank accounts (as rows with balances), Credit cards (as tiles), and Investments (as rows with latest balance + latest change).
- **Add** FAB scoped to Wallet (cash/bank/card/investment).
- Empty state prompts adding the first account.

---

## 14. Cash & bank accounts

- **Kinds:** `cash` and `bank`.
- **Fields:** name, bank/issuer (bank only — hidden for cash), currency (EUR/INR), opening/current balance.
- Add, edit, and **move to Trash**.
- **Balance** = `opening + Σ(deposits) − Σ(expenses)`, coloured green when ≥ 0, red when negative.
- Full transaction ledger (see next section).

---

## 15. Account transaction ledger

Every cash/bank account keeps a full ledger (this is the chosen model — not just a running number).

- **Money in (deposit)** and **money out (expense)**.
- Each entry: amount, description, **category** (from: Groceries, Rent, Bills, Transport, Eating out, Shopping, Salary, Transfer, Health, Other), date-time (defaults to now, editable).
- Entries listed newest-first, each showing a signed coloured amount (+green in / −red out) and the **running balance** at that point.
- **Delete** an individual entry (permanent, with confirmation — entries are not soft-deleted).

---

## 16. Credit cards

- **Kind:** `card`.
- **Fields:** name, issuer, currency, **credit limit**, **current outstanding** (optional at creation), **repayment due day** of the month (1–28).
- **Charge/payment ledger:** charges increase outstanding, payments reduce it.
- **Outstanding** = `opening + Σ(charges) − Σ(payments)`.
- **Available credit** = `limit − outstanding`.
- **Usage bar** = `outstanding / limit`.
- **Next repayment date:** computed from the due day; if this month's day has passed, it rolls to next month. The due day is clamped to the month's length.
- **Days left** until the next due date is shown; **within 5 days is highlighted** as "soon".
- Card **tile** shows: name, issuer, currency, usage bar, outstanding / available / limit, and the repayment line.
- `statementDay` exists in the data model but is **not yet surfaced** in the UI (reserved for a future statement-vs-due distinction).

---

## 17. Investments (Stocks)

Tracks brokerage platforms — e.g. **Groww**, **Upstox**, or any others the user adds — as part of the Wallet layer. Unlike accounts, an investment platform has no deposit/withdrawal ledger: the user simply logs what the account is worth today, on any day they check it.

- **Add a platform:** name (free text, with Groww/Upstox suggested), currency, note. Add, edit, and **move to Trash**.
- **Enter today's balance:** a single number — what the platform shows as the total value right now. One snapshot per calendar date; entering a balance again for a date that already has one **updates** it rather than creating a duplicate.
- **Profit/loss** for a snapshot = **that day's balance − the immediately preceding recorded balance** (not the same calendar day necessarily — the previous *entry*, whatever date it was logged on). Positive = profit (green), negative = loss (red). The very first entry for a platform has no P/L yet (nothing to compare against).
- **Platform detail screen:** current balance, latest change, cumulative change since the first recorded entry, and a full history list (newest first) with each entry's date, balance, and the change vs. the entry before it. Any entry can be deleted.
- **Wallet overview** shows an Investments section: each platform's latest balance and latest change, plus aggregate **Value** and **Latest change** totals per currency across all platforms.
- Investments are **never combined** with cash/bank/card totals or with loan balances — they get their own figures, per currency, like everything else in this app.

---

## 18. Reminders

All reminders are **in-app** (there are no push notifications — that would need a backend, which the app deliberately avoids).

- **Loan overdue:** an open entry with remaining > 0 whose due date has passed.
- **Loan stale:** an open entry with remaining > 0 and no activity for 30+ days.
- **Card repayment due:** countdown to the next due date; "due soon" when within 5 days.
- Surfaced on the Home "Needs attention" list, the Wallet "Repayments due" list, and as tab-bar badges.

---

## 19. Trash & auto-purge

- Holds soft-deleted **people, loan entries, accounts, and investment platforms**.
- Each item shows a **days-remaining countdown** (`retention − days since deletion`).
- **Restore** an item, or **permanently delete** it.
- **Empty trash now** permanently deletes everything in Trash (with confirmation).
- **Auto-purge:** on app boot (a few seconds after load), any item older than the retention window is permanently removed. Purging a person/account/investment platform also deletes its sub-entries (txns / entries / balances respectively).
- **Retention window** is configurable in Settings (default 30 days).
- Reached from **Settings** (shows a count).

---

## 20. Reports & exports

- **Per-currency summary:** owed to you, you owe, and net — one block per currency.
- **Export CSV** — loan transactions, opens in any spreadsheet.
- **Export Excel (.xlsx)** — loan transactions (SheetJS, lazy-loaded).
- **Export full report (PDF)** — all people and balances (jsPDF, lazy-loaded).
- **Per-person statement (PDF)** — from the person detail screen.
- Excel/PDF need an internet connection the first time (they fetch a library from a CDN). CSV works fully offline.
- **Current scope:** exports cover **loans only**. Account/card spending and investment history are included in the JSON backup but not yet in these exports (see roadmap).

---

## 21. Backup & restore

- **Back up all data:** downloads a JSON file (`version: 3`) containing settings, all people (with their loan entries), all accounts (with their entries), all investment platforms (with their balance history), and all notes.
- **Restore from backup:** imports a JSON file and **adds** its people, accounts, investment platforms, and notes to the current data (existing data is kept, not overwritten). Confirms the counts before importing.
- Works fully offline.

---

## 22. Settings

- **Appearance:** dark-theme toggle.
- **Security:** app-lock (PIN) toggle → set/confirm/turn-off flows.
- **Defaults:**
  - Default currency (EUR/INR) used when adding new entries, accounts, and investment platforms.
  - Trash retention (7 / 14 / 30 / 60 / 90 days).
- **Data:** Trash (with count) · Back up all data · Restore from backup.
- **Sign out.**
- Shows the signed-in account email.

---

## 23. Theming

- **Dark** (default) and **light** themes.
- Persisted to `settings/app.theme` (syncs across devices) and cached in `localStorage` so the correct theme paints instantly on load, before Firestore responds.

---

## 24. PWA & offline

- **Installable** via `manifest.webmanifest` (standalone display, 192/512/maskable icons, theme colour, start URL).
- **Service worker** (`sw.js`): caches the app shell **cache-first** under cache name `ledger-shell-v1`; ignores Firebase/Google origins so the SDK manages its own network.
- **Offline:** the app shell loads offline; Firestore offline persistence keeps data available and queues writes.
- Apple touch icon and iOS web-app meta tags included.
- **Release rule:** whenever any app file changes, **bump the `CACHE` version string in `sw.js`** or installed users keep the old cached files.

---

## 25. Currency rules

- Supported: **EUR (€)** formatted `en-IE`, **INR (₹)** formatted `en-IN`.
- **Never** summed across currencies — anywhere, including investments.
- Every total (people net, wallet on-hand, card debt, available credit, investment value/P&L, reports) is computed and displayed **per currency**.
- A person's **primary balance** (shown on list rows) is the currency with the largest absolute net; a `+N ccy` hint signals additional currencies.
- Adding a new currency should be a matter of extending the currency table and its formatting locale.

---

## 26. Edge cases & business rules

- Payments are capped at the remaining amount in the slider; typing more still records and simply auto-settles (overpayment surfaced on the loan detail).
- A loan auto-settles when remaining ≤ 0; it can be reopened.
- Settled and trashed loans are **excluded** from all balance/net calculations.
- A person can hold balances in both currencies at once; they are reported separately and never combined.
- Card due dates roll forward monthly and clamp to the month length (e.g. day 31 → last day of a short month).
- **Soft-delete vs hard-delete:** people, loan entries, accounts, and investment platforms are soft-deleted to Trash; **account ledger entries and investment balance entries are hard-deleted** immediately (with confirmation).
- Individual loan **payments** currently cannot be edited or deleted after recording — only the whole loan entry can be edited/trashed (see roadmap).
- An investment platform's profit/loss is always computed against the **previous recorded entry**, not a fixed calendar interval — if you skip a week, that week's movement all lands on the next entry you log.

---

## 27. Known limitations / non-goals

- **No push notifications.** Reminders are in-app only; real notifications would require a backend, which the app avoids by design.
- **No auto-linking** between loans, account balances, and investment balances (explicit product decision).
- **No merged net worth** across accounts, loans, and investments (explicit product decision).
- **No multi-user / sharing.** Data is single-owner, per Firebase account.
- **Exports are loans-only** for now.
- **Currencies limited** to EUR and INR (extensible).
- **No brokerage integration.** Investment balances are entered by hand — there's no live price feed or API connection to Groww/Upstox/any broker.

---

## 28. Roadmap / open items

Tracked so they don't get lost:

1. **Spending export** — include account/card transactions and investment history in CSV and Excel (e.g. separate sheets), and optionally a spending PDF.
2. **Editable / removable individual payments** on a loan.
3. **More currencies** beyond EUR/INR.
4. **Card statement date** — surface `statementDay` (statement vs. payment-due distinction).
5. Optional per-account / per-investment export or statement (like the per-person loan statement).
6. **Investment charts** — a simple line/area chart of balance over time per platform.

When picking one up: branch `feature/<name>`, implement, update this file if behaviour changes, commit with a `feat:`/`fix:` message, and bump `sw.js` `CACHE`.

---

## 29. Notes (quick log)

For anything that isn't a loan and isn't tied to a specific wallet account — sending
money to family, a cash spend while travelling, anything you just want to remember
happened. No account to set up first, no balance, no lent/borrowed direction.

- **Fields:** a short note/description (required), an amount, a currency (EUR/INR),
  and a date-time (defaults to now, editable).
- **Add** via the FAB quick-add ("+ Quick note") from anywhere, or the Notes list's
  own FAB.
- **List:** newest first, each row shows the note text, date, and amount. A **Total
  noted** card at the top sums amounts per currency (informational only — not a
  balance, nothing to reconcile against).
- **Edit** any note in place. **Delete** is immediate (hard-delete, with
  confirmation) — notes are simple log entries, not soft-deleted like people/accounts.
- Surfaced on the **Home** dashboard as a "Notes" section (last 5 entries + a link to
  the full list), and reachable at `#/notes` (not in the bottom tab bar — same
  pattern as Trash).
- Included in JSON backup/restore (`version: 3`).
- **Not exported** to CSV/Excel/PDF yet (those cover loans only — see roadmap).

---

## 30. File map

```
index.html             app shell + PWA meta
css/styles.css         design system (dark + light), all components
js/config.js           Firebase keys (web keys are public; safe to commit)
js/app.js              the entire application
manifest.webmanifest   PWA manifest
sw.js                  service worker (offline shell) — bump CACHE on release
firestore.rules        Firestore security rules (see section 4)
icons/                 192 / 512 / maskable-512 PNGs
README.md              setup, security rules, deploy
CONTRIBUTING.md        branch & commit conventions, local run, release steps
FEATURES.md            this document
```
