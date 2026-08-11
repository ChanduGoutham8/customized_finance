# Ledger — Final Specification

> This is the canonical, standalone spec for what this app should do next.
> Written so it's understandable with zero prior context — hand it to any AI
> or developer and it should be enough to implement correctly without
> re-deriving intent. It supersedes anything conflicting in FEATURES.md
> (the original spec) or PHASE_PLAN.md (the working notes that led here).
> Nothing described below is built yet.

---

## 1. What this app is, updated

Three layers, still never merged into one number:
1. **People / Loans** — money lent to or borrowed from people, now linked to
   real accounts (§6).
2. **Wallet** — cash, bank accounts, credit cards.
3. **Investments** — daily balance snapshots per platform (Groww, Upstox,
   etc.). Unchanged, untouched by anything in this document.

A fourth thing sits alongside the layers, not as a fourth layer but as a
lens on top of Wallet + Loans: **Net Income / Net Spending** (§7) — a
curated view of which money movements were "real" economic activity, kept
deliberately separate from three things: Credit Cards, Investments, and
Subscriptions.

**The standalone Notes feature no longer exists.** Removed entirely — no
page, no data model, no free-floating record with no account attached.
Anything that used to be a Note is now a normal transaction against a real
account (§4).

---

## 2. Loan payments — editable and deletable individually

**Current problem:** once a payment is recorded against a loan, it's
permanent. Fixing it means trashing the whole loan.

**Required behavior:**
- Any individual payment on a loan can be **edited** or **deleted**. The
  confirmed, worked case is editing the **amount** (e.g. correcting a
  typo'd €50 to €40). Whether date and note should also be editable wasn't
  separately discussed — reasonable to extend the same edit affordance to
  them, but treat that as an assumption, not a confirmed requirement, if it
  turns out to matter.
- Editing or deleting recalculates the loan's Paid and Remaining
  immediately and automatically.
- If deleting a payment brings Remaining back above zero on a Settled loan,
  the loan automatically reopens to Open.
- Each edit/delete shows a prompt — *"Save a note about this change?"* —
  optional, free text, written by the user. Answering no still applies the
  edit/delete; it only skips adding a note to history.

**Known, accepted limitation — do not build around this, it's intentional:**
a payment's link to a Wallet account (§6) is not automatically kept in sync
when the payment is edited or deleted. If a €50 repayment (linked to an
account per §6) gets corrected to €40 via this feature, the linked account
entry does **not** automatically update to match. This was raised as a gap
and explicitly declined — the user has chosen to rely on careful data entry
instead of automatic syncing here. Do not add automatic syncing unless
asked.

---

## 3. Bug: floating "+" button overlaps content

**Root cause:** the scrollable content area's bottom padding is smaller
than the floating action button's actual footprint (the button's position
plus its own height), leaving a dead zone where the button visually sits on
top of page content near the bottom.

**Fix:** increase that one padding value so it's always larger than the
button's full vertical extent. This is a single structural CSS fix, not a
per-page patch — applying it once corrects every page that has the button,
including ones not yet individually checked.

---

## 4. Add Transaction — replaces Notes entirely

Every transaction — spending, receiving money, moving money between your
own accounts — goes through one flow that **requires an account before it
will save**. (This is the flow for plain Wallet activity specifically —
loan-linked entries have their own separate entry point, the existing loan
form, which independently asks for an account per §6. Both paths produce
the same kind of Wallet entry underneath, both are subject to §7.)

1. **Account** (required) — only active, non-trashed accounts are
   selectable.
2. **Direction** — Money in / Money out for cash and bank accounts; Charge /
   Payment for credit cards (§5).
3. **Amount.**
4. **Description** (optional free text — "Sent to father," "Netflix" —
   exactly like a bank app's note-when-sending-money field). This describes
   *what* the transaction is. It's the only place that applies — there is
   no separate standalone note feature anymore. (§2's payment-edit note is
   a distinct, narrower thing: it explains *why* a correction was made to
   an existing payment, not what a transaction was — don't conflate the
   two into one field.)
5. **Date.**
6. See **§7** — for cash/bank accounts, this flow also asks the
   Income/Spending question described there.

**Negative balances are allowed, not blocked.** This is a self-maintained
ledger, not a live bank connection — it never rejects an entry for
insufficient funds.

---

## 5. Credit cards — fully separate from Income/Spending

Cards go through the same Add Transaction flow, but selecting a card swaps
the direction options to **Charge** (increases outstanding debt) and
**Payment** (decreases it) — matching how cards already work today.

Paying off a card bill is always **two separate entries**, since accounts
aren't auto-linked: a Payment entry on the card (outstanding → down), and a
separate Money-out entry on whichever bank/cash account actually paid it.

**Cards are entirely excluded from §7 (Income/Spending):** neither a Charge
nor a Payment entry on a card ever shows the Income/Spending question, and
neither ever counts toward Net Income or Net Spending. The card section is
kept completely out of this feature — it only affects Card Debt / Available
Credit, which already exist and are unchanged. (The bank/cash side of
paying off a card *does* go through the normal §7 question, same as any
other Wallet entry. Answer **No** — the real spending already happened the
moment the card was charged; counting the payoff again would double it.)

---

## 6. Loans tie to real accounts

**Current problem:** lending or repaying money only changes numbers inside
the loan record — it never touches an actual account, even though real
cash moves.

**Required behavior:**
- **Creating a loan** (lending or borrowing) asks which account the money
  moved through.
- **Recording a repayment** against a loan also asks which account the
  money moved through.
- The account's balance always moves to match the real direction of cash:
  lending decreases your account, being repaid increases it; borrowing
  increases your account, repaying someone you owe decreases it.
- The account picked must be in the same currency as the loan (no
  cross-currency modeling anywhere in this app — see §9).
- The Wallet entry this creates is a normal entry in every respect,
  including going through §7's Income/Spending question.

---

## 7. Income / Spending — a yes/no question per transaction, not a category rule

This is the core mechanism and the part most likely to be implemented
wrong if summarized loosely, so it's stated precisely here:

**Where it applies:** every Wallet transaction created via Add Transaction
(§4) — spending, receiving money, transfers between your own accounts —
**and** every loan-linked entry (§6) — lending, borrowing, and repayment,
all three.

**Where it never applies — no popup shown, entry is simply never eligible.
Three categories:**
1. **Credit card Charge/Payment entries (§5)** — go through Add
   Transaction, but excluded from this feature entirely.
2. **Subscription-tagged entries** — tagged with their own category (a new
   one to add to the existing preset list); logged the normal way through
   Add Transaction, still reduce the account's real balance, but
   automatically excluded, no popup asked.
3. **Investment balance entries** — not excluded so much as structurally
   unrelated: Investments have their own "enter today's balance" flow
   entirely separate from Add Transaction, so this question was never
   going to reach them in the first place. No exclusion logic needed
   there, just don't accidentally wire the two systems together.

**The mechanism, exactly:** when an entry is eligible (i.e., not one of the
three exclusions above), saving it shows one question:
- Money out → *"Include this in Spending?"* (Yes/No)
- Money in → *"Include this in Income?"* (Yes/No)

The answer is stored per-entry (e.g. a boolean field on the entry). It
controls **only** whether the entry is included when Net Income/Net
Spending are calculated. It has **zero** effect on whether the account's
real balance changes — that always happens, unconditionally, regardless of
the answer.

**This answer is editable later**, same as the rest of the entry — since
Net Income/Spending are always calculated live (next point), changing an
old entry's answer just naturally updates the totals, nothing else to
touch.

**Net Income and Net Spending must be calculated live, never stored as a
running total.** Every time they're displayed, recompute by summing every
currently-eligible entry currently marked "yes," per currency. Do not
increment/decrement a stored counter when entries are created — if that
approach is used, edits and deletes will require separate, error-prone
logic to keep the counter correct. Live calculation makes that entire class
of bug impossible by construction, the same way Net Amount (§8) already
avoids it today by being a direct balance sum rather than a cached figure.

**Worked example** (Deutsche Bank starts at €500):
| Action | Popup answer | Balance after | Net Spending | Net Income |
|---|---|---|---|---|
| Salary €900 in | Include in Income? → **Yes** | €1,400 | — | +€900 |
| Lend Sripal €100 (§6) | Include in Spending? → **No** | €1,300 | +€0 | — |
| Sripal repays €100 (§6) | Include in Income? → **No** | €1,400 | — | +€0 |
| Move €50 to a cash account | Include in Spending? → **No** | €1,350 | +€0 | — |
| Groceries €50 | Include in Spending? → **Yes** | €1,300 | +€50 | — |

Final: Net Amount (EUR) = €1,300 (exact, always — direct balance sum: €500
opening + €900 − €100 + €100 − €50 − €50). Net Income (EUR) = €900. Net
Spending (EUR) = €50. Income − Spending = €900 − €50 = €850 — but the
account's actual total change over the same period was €500 → €1,300, only
+€800. The €50 difference is the transfer-out step, answered "No": it
really did leave this account, so it's inside Net Amount's balance sum, but
it was deliberately excluded from Net Spending, so it's not inside the
Income − Spending figure. **This mismatch is correct, not a bug.** Net
Amount is ledger truth, always exact by construction. Net Income/Spending is
a curated, user-judged view that will not always arithmetically reconstruct
the balance whenever a transfer or a loan is involved — the two figures
aren't meant to explain each other.

**No cross-currency transfers anywhere in this system** — see §9.

---

## 8. Dashboard

Six figures: Net Income, Net Spending, Net Amount — each shown separately
for EUR and for INR. All-time totals (a date-range filter is explicitly
future work, not part of this spec — see §11). Net Amount is unchanged from
how it already works today (a direct sum of account balances); Net Income
and Net Spending are new, computed as described in §7.

---

## 9. Explicitly out of scope — do not build these

- **Cross-currency transfers or cross-currency loan repayments.** A
  transfer or a loan-linked account must be the same currency on both
  sides. Real EUR↔INR movement is handled by the user outside the app.
  Raised and deliberately declined.
- **Automatic syncing between an edited/deleted loan payment (§2) and its
  linked Wallet entry (§6).** Declined — see §2's "known, accepted
  limitation."
- **Backup/restore version handling for the old Notes format.** The user
  doesn't use backup/restore; not needed.
- **A dedicated category for gifts/family transfers.** "Other" plus the
  free-text description is sufficient; not needed.

---

## 10. Archive — a new concept, separate from Trash

**Problem it solves:** old data from a removed feature (specifically, one
leftover Note logged before Notes was removed) has nowhere to live —
permanently deleting it destroys a record that existed; Trash isn't right
either, since Trash auto-purges.

| | Trash (existing) | Archive (new) |
|---|---|---|
| Purpose | Recently deleted, might want it back | Deliberately retired, kept forever |
| Auto-purge | Yes, after the retention window (default 30 days) | Never |
| How it's removed | Restore, or the retention window elapses | Only an explicit, manual "permanently delete" from inside the Archive itself |
| Reached from | Settings (shows a count) | Settings (shows a count), next to Trash |

Build as a general, reusable mechanism — not a one-off for this single
record. Anything retired from the app in the future has somewhere
permanent and tidy to go. The one existing record to migrate: the old
"Sent to father, ₹30,000" Note, as a read-only entry with its original
text, amount, currency, and date preserved, with no effect on any balance
(it never had one).

---

## 11. Deferred — acknowledged, not detailed, not part of this build

These were identified earlier as real gaps but intentionally left
unspecified for now, lower priority than everything above:

- A global activity log spanning People/Wallet/Investments in one feed
- Charts: spending by category, net worth over time, investment value over
  time
- A date-range filter (monthly/yearly) for Reports and the dashboard
- Budgets / spending limits per category
- Exporting Wallet/Investments data to CSV/Excel/PDF (export currently
  covers loans only)
- Attachments or receipt photos on entries
- Richer, custom reminders beyond the existing overdue/stale/card-due-soon
  alerts

---

## 12. Operational note, not a feature
Two test records currently exist in the live app — "Vivek" and "Sripal"
under People — flagged for removal, timing not yet decided by the user.
Not a build task, just don't be surprised they're there.
