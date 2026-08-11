// ============================================================================
// Ledger — entire application (vanilla JS, ES modules, hash router, Firebase).
// See FEATURES.md for the full behavioural spec.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, collectionGroup, query, where, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, getDocs, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ============================================================================
// Constants
// ============================================================================

const CURRENCIES = {
  EUR: { symbol: "€", locale: "en-IE" },
  INR: { symbol: "₹", locale: "en-IN" },
};
const CURRENCY_CODES = Object.keys(CURRENCIES);

const PEOPLE_TAGS = ["Family", "Friends", "Work", "Neighbour"];
const ENTRY_CATEGORIES = ["Groceries", "Rent", "Bills", "Transport", "Eating out", "Shopping", "Salary", "Transfer", "Health", "Subscriptions", "Other"];
const RETENTION_OPTIONS = [7, 14, 30, 60, 90];
const STALE_DAYS = 30;
const DUE_SOON_DAYS = 5;
const DEFAULT_INVESTMENT_PLATFORMS = ["Groww", "Upstox"];

// ============================================================================
// State
// ============================================================================

const S = {
  authReady: false,
  user: null,
  settings: { theme: "dark", pinHash: null, defaultCurrency: "EUR", purgeDays: 30 },
  people: [],
  txns: [],        // flattened loan entries across all people, each carries personId
  accounts: [],
  entries: [],     // flattened account ledger entries, each carries accountId
  investments: [],
  balances: [],    // flattened investment balance snapshots, each carries investmentId
  unlockedThisSession: false,
  unsubs: [],
  purgeChecked: false,
};

// ============================================================================
// Small utilities
// ============================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtMoney(amount, ccy) {
  const c = CURRENCIES[ccy] || CURRENCIES.EUR;
  return new Intl.NumberFormat(c.locale, { style: "currency", currency: ccy }).format(amount || 0);
}

function fmtSigned(amount, ccy) {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return sign + fmtMoney(Math.abs(amount), ccy).replace(/^-/, "");
}

function fmtDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function toISODate(ms) {
  const d = new Date(ms);
  const off = d.getTimezoneOffset();
  return new Date(ms - off * 60000).toISOString().slice(0, 10);
}
function toDateTimeLocal(ms) {
  const d = new Date(ms);
  const off = d.getTimezoneOffset();
  return new Date(ms - off * 60000).toISOString().slice(0, 16);
}
function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}
function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}
function directionOf(net) {
  if (net > 0.005) return "credit";
  if (net < -0.005) return "debit";
  return "settled";
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function navigate(hash) {
  if (location.hash === hash) { renderCurrent(); return; }
  location.hash = hash;
}

// ---- Toasts ----
function toast(message, opts = {}) {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${escapeHtml(message)}</span>` + (opts.actionLabel ? `<button type="button">${escapeHtml(opts.actionLabel)}</button>` : "");
  if (opts.actionLabel) {
    el.querySelector("button").addEventListener("click", () => {
      opts.onAction?.();
      el.remove();
    });
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), opts.duration || 5000);
}

// ---- Bottom sheets ----
function openSheet(innerHtml, { onMount, onSubmit } = {}) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="sheet-backdrop"><div class="sheet"><div class="grabber"></div>${innerHtml}</div></div>`;
  const backdrop = $(".sheet-backdrop", root);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeSheet(); });
  const form = $("form", root);
  if (form && onSubmit) {
    form.addEventListener("submit", (e) => { e.preventDefault(); onSubmit(new FormData(form), form); });
  }
  onMount?.(root);
}
function closeSheet() { $("#sheet-root").innerHTML = ""; }

// ============================================================================
// Router
// ============================================================================

function parseHash() {
  const raw = (location.hash || "#/").slice(1);
  const parts = raw.split("/").filter(Boolean);
  return { name: parts[0] || "", params: parts.slice(1) };
}

function renderShell({ title, back, content, tab, fab, headerRight }) {
  const tabs = [
    { id: "", label: "Home", route: "#/", icon: iconHome },
    { id: "people", label: "People", route: "#/people", icon: iconPeople },
    { id: "wallet", label: "Wallet", route: "#/wallet", icon: iconWallet },
    { id: "reports", label: "Reports", route: "#/reports", icon: iconReports },
    { id: "settings", label: "Settings", route: "#/settings", icon: iconSettings },
  ];
  const overdueCount = S.txns.filter(isOverdue).length;
  const dueSoonCards = S.accounts.filter((a) => a.kind === "card" && !a.deletedAt && isCardDueSoon(a)).length;

  const tabHtml = tabs.map((t) => {
    let badge = "";
    if (t.id === "" && overdueCount) badge = `<span class="badge">${overdueCount}</span>`;
    if (t.id === "wallet" && dueSoonCards) badge = `<span class="badge">${dueSoonCards}</span>`;
    return `<button type="button" class="tab ${tab === t.id ? "active" : ""}" data-action="nav" data-hash="${t.route}">
      ${t.icon}<span>${t.label}</span>${badge}
    </button>`;
  }).join("");

  return `
    <div class="topbar">
      ${back ? `<button type="button" class="back" data-action="nav" data-hash="${back}">${iconBack}</button>` : ""}
      <h1>${escapeHtml(title)}</h1>
      <div class="spacer"></div>
      ${headerRight || ""}
    </div>
    <main class="view">${content}</main>
    ${fab ? `<button type="button" class="fab" data-action="${fab}">+</button>` : ""}
    <nav class="tabbar">${tabHtml}</nav>
  `;
}

function renderCurrent() {
  if (!S.authReady) return;
  const root = $("#root");
  if (!S.user) { root.innerHTML = viewAuth.render(); wireAuth(); return; }
  if (needsPinLock()) { root.innerHTML = viewPinLock.render(); wirePinLock(); return; }

  const { name, params } = parseHash();
  let html;
  switch (name) {
    case "": html = viewHome(); break;
    case "people": html = viewPeopleList(); break;
    case "person": html = viewPersonDetail(params[0]); break;
    case "txn": html = viewTxnDetail(params[0], params[1]); break;
    case "wallet": html = viewWallet(); break;
    case "account": html = viewAccountDetail(params[0]); break;
    case "investment": html = viewInvestmentDetail(params[0]); break;
    case "reports": html = viewReports(); break;
    case "trash": html = viewTrash(); break;
    case "settings": html = viewSettings(); break;
    default: html = viewHome();
  }
  root.innerHTML = html;
  wireTxnDetailSlider();
}

// Delegated action dispatch: any element with data-action="fnName" calls actions[fnName](el, event).
// These listeners are attached ONCE to the persistent #root/#sheet-root containers (not per-render —
// innerHTML swaps replace children but the containers themselves stay put, so re-attaching on every
// render would accumulate duplicate listeners).
const actions = {};
const liveInputActions = new Set(["people-search"]);

const rootEl = $("#root");
rootEl.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const name = el.dataset.action;
  if (name === "nav") { navigate(el.dataset.hash); return; }
  actions[name]?.(el, e);
});
rootEl.addEventListener("input", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !liveInputActions.has(el.dataset.action)) return;
  if (el.dataset.action === "people-search") {
    peopleUi.search = el.value;
    renderCurrent();
    const input = $("[data-action='people-search']");
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
});
rootEl.addEventListener("change", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName !== "SELECT") return;
  actions[el.dataset.action]?.(el, e);
});
$("#sheet-root").addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const name = el.dataset.action;
  if (name === "close-sheet") { closeSheet(); return; }
  if (name === "nav") { closeSheet(); navigate(el.dataset.hash); return; }
  actions[name]?.(el, e);
});

window.addEventListener("hashchange", renderCurrent);

// ============================================================================
// Icons (inline SVG, currentColor)
// ============================================================================
const iconHome = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>`;
const iconPeople = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="8.5" r="2.5"/><path d="M16 14.2c2.7.4 4.5 2.4 4.5 5.3"/></svg>`;
const iconWallet = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><circle cx="17" cy="14" r="1.2" fill="currentColor" stroke="none"/></svg>`;
const iconReports = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>`;
const iconSettings = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 00-.15-1.4l2-1.5-2-3.4-2.3.9a7 7 0 00-2.4-1.4L14 2.5h-4l-.15 2.7a7 7 0 00-2.4 1.4l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .5.05 1 .15 1.4l-2 1.5 2 3.4 2.3-.9c.7.6 1.5 1.1 2.4 1.4L10 21.5h4l.15-2.7a7 7 0 002.4-1.4l2.3.9 2-3.4-2-1.5c.1-.4.15-.9.15-1.4z"/></svg>`;
const iconBack = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;

// ============================================================================
// Business logic helpers
// ============================================================================

function activePeople() { return S.people.filter((p) => !p.deletedAt); }
function activeAccounts() { return S.accounts.filter((a) => !a.deletedAt); }
function activeInvestments() { return S.investments.filter((i) => !i.deletedAt); }
function personTxns(pid) { return S.txns.filter((t) => t.personId === pid && !t.deletedAt); }
function openPersonTxns(pid) { return personTxns(pid).filter((t) => t.status === "open"); }

function txnRemaining(t) {
  const paid = (t.payments || []).reduce((s, p) => s + p.amount, 0);
  return t.principal - paid;
}
function txnPaid(t) { return (t.payments || []).reduce((s, p) => s + p.amount, 0); }
function isOverdue(t) {
  if (t.deletedAt || t.status !== "open" || txnRemaining(t) <= 0) return false;
  return !!t.dueDate && t.dueDate < toISODate(Date.now());
}
function isStale(t) {
  if (t.deletedAt || t.status !== "open" || txnRemaining(t) <= 0) return false;
  const lastActivity = Math.max(t.createdAt, ...(t.payments || []).map((p) => p.at));
  return daysBetween(lastActivity, Date.now()) >= STALE_DAYS;
}
function lastActivityOf(t) {
  return Math.max(t.createdAt, ...(t.payments || []).map((p) => p.at));
}

// personNet[currency] = +ve means they owe you (credit), -ve means you owe them
function personNet(pid) {
  const net = {};
  for (const t of personTxns(pid)) {
    if (t.status === "settled") continue;
    const remaining = txnRemaining(t);
    if (remaining <= 0) continue;
    const signed = t.type === "lent" ? remaining : -remaining;
    net[t.currency] = (net[t.currency] || 0) + signed;
  }
  return net;
}
function personPrimaryCurrency(pid) {
  const net = personNet(pid);
  const entries = Object.entries(net).filter(([, v]) => Math.abs(v) > 0.005);
  if (!entries.length) return { ccy: S.settings.defaultCurrency, amount: 0, extra: 0 };
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return { ccy: entries[0][0], amount: entries[0][1], extra: entries.length - 1 };
}
function totalsByDirection() {
  const owedToYou = {}, youOwe = {};
  for (const p of activePeople()) {
    const net = personNet(p.id);
    for (const [ccy, v] of Object.entries(net)) {
      if (v > 0.005) owedToYou[ccy] = (owedToYou[ccy] || 0) + v;
      else if (v < -0.005) youOwe[ccy] = (youOwe[ccy] || 0) + -v;
    }
  }
  return { owedToYou, youOwe };
}

function accountEntries(aid) { return S.entries.filter((e) => e.accountId === aid).sort((a, b) => a.at - b.at); }
function accountBalance(a) {
  const es = accountEntries(a.id);
  if (a.kind === "card") {
    return (a.opening || 0) + es.reduce((s, e) => s + (e.type === "charge" ? e.amount : -e.amount), 0);
  }
  return (a.opening || 0) + es.reduce((s, e) => s + (e.type === "deposit" ? e.amount : -e.amount), 0);
}
function cardAvailable(a) { return (a.limit || 0) - accountBalance(a); }
function cardNextDue(a) {
  if (!a.dueDay) return null;
  const now = new Date();
  const clamp = (y, m) => Math.min(a.dueDay, new Date(y, m + 1, 0).getDate());
  let y = now.getFullYear(), m = now.getMonth();
  let due = new Date(y, m, clamp(y, m));
  if (due.getTime() < new Date(y, m, now.getDate()).getTime()) {
    m += 1; if (m > 11) { m = 0; y += 1; }
    due = new Date(y, m, clamp(y, m));
  }
  return due.getTime();
}
function isCardDueSoon(a) {
  const due = cardNextDue(a);
  if (!due || accountBalance(a) <= 0) return false;
  return daysBetween(Date.now(), due) <= DUE_SOON_DAYS;
}

function walletOnHand() {
  const totals = {};
  for (const a of activeAccounts()) {
    if (a.kind === "card") continue;
    totals[a.currency] = (totals[a.currency] || 0) + accountBalance(a);
  }
  return totals;
}
function walletCardDebt() {
  const totals = {};
  for (const a of activeAccounts()) {
    if (a.kind !== "card") continue;
    totals[a.currency] = (totals[a.currency] || 0) + Math.max(0, accountBalance(a));
  }
  return totals;
}
function walletAvailableCredit() {
  const totals = {};
  for (const a of activeAccounts()) {
    if (a.kind !== "card") continue;
    totals[a.currency] = (totals[a.currency] || 0) + cardAvailable(a);
  }
  return totals;
}

// ---- Income / Spending: a per-entry yes/no answer, not a category rule ----
// Credit cards and Subscription-tagged entries are never eligible — they
// never show the popup and never count, regardless of any answer.
const SUBSCRIPTIONS_CATEGORY = "Subscriptions";

function isIncomeSpendingEligible(account, category) {
  if (!account || account.kind === "card") return false;
  if (category === SUBSCRIPTIONS_CATEGORY) return false;
  return true;
}

// Shows the yes/no popup only when eligible; otherwise calls back immediately
// with null (meaning "not applicable", no field to set). onFinalize receives
// true/false/null.
function withIncomeSpendingAnswer(account, category, isIncoming, onFinalize) {
  if (!isIncomeSpendingEligible(account, category)) { onFinalize(null); return; }
  askIncludeInIncomeSpending(isIncoming ? "income" : "spending", (answer) => onFinalize(answer));
}

function askIncludeInIncomeSpending(direction, onAnswer) {
  const isIncome = direction === "income";
  openSheet(`
    <h2>${isIncome ? "Include this in Income?" : "Include this in Spending?"}</h2>
    <p class="muted" style="font-size:0.85rem">This only affects your Net ${isIncome ? "Income" : "Spending"} total — the account balance updates either way.</p>
    <div class="btn-row">
      <button type="button" class="btn ghost" data-yesno="no">No</button>
      <button type="button" class="btn primary" data-yesno="yes">Yes</button>
    </div>
  `, {
    onMount: (root) => {
      $$("[data-yesno]", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          const answer = btn.dataset.yesno === "yes";
          closeSheet();
          onAnswer(answer);
        });
      });
    },
  });
}

// Net Income/Spending are always calculated live from current entries —
// never a stored running total — so edits/deletes never need separate sync.
function netIncomeSpendingTotals() {
  const income = {}, spending = {};
  for (const e of S.entries) {
    if (e.countedInIncomeSpending !== true) continue;
    const account = S.accounts.find((a) => a.id === e.accountId);
    if (!isIncomeSpendingEligible(account, e.category)) continue;
    const ccy = account.currency;
    if (e.type === "deposit") income[ccy] = (income[ccy] || 0) + e.amount;
    else if (e.type === "expense") spending[ccy] = (spending[ccy] || 0) + e.amount;
  }
  return { income, spending };
}

// ---- Investments (Groww / Upstox style daily balances) ----
function investmentBalances(iid) {
  return S.balances.filter((b) => b.investmentId === iid).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
}
function investmentLatest(iid) {
  const bs = investmentBalances(iid);
  return bs.length ? bs[bs.length - 1] : null;
}
function investmentPL(iid) {
  // profit/loss of the latest entry vs the one immediately before it
  const bs = investmentBalances(iid);
  if (bs.length < 2) return 0;
  return bs[bs.length - 1].amount - bs[bs.length - 2].amount;
}
function investmentCumulativePL(iid) {
  const bs = investmentBalances(iid);
  if (bs.length < 2) return 0;
  return bs[bs.length - 1].amount - bs[0].amount;
}
function investmentsTotalValue() {
  const totals = {};
  for (const inv of activeInvestments()) {
    const latest = investmentLatest(inv.id);
    if (!latest) continue;
    totals[inv.currency] = (totals[inv.currency] || 0) + latest.amount;
  }
  return totals;
}
function investmentsTotalPL() {
  const totals = {};
  for (const inv of activeInvestments()) {
    totals[inv.currency] = (totals[inv.currency] || 0) + investmentPL(inv.id);
  }
  return totals;
}

function currencyRows(totalsObj, opts = {}) {
  const codes = Object.keys(totalsObj).filter((c) => Math.abs(totalsObj[c]) > 0.005 || opts.showZero);
  if (!codes.length) return `<p class="muted">${opts.emptyLabel || "Nothing yet"}</p>`;
  return codes.map((ccy) => `
    <div class="stat">
      <div class="label">${ccy}</div>
      <div class="value ${opts.colorClass ? opts.colorClass(totalsObj[ccy]) : ""}">${fmtMoney(totalsObj[ccy], ccy)}</div>
    </div>
  `).join("");
}

// ============================================================================
// AUTH VIEWS
// ============================================================================

const viewAuth = {
  mode: "signin", // signin | signup | forgot
  error: "",
  render() {
    const m = viewAuth.mode;
    return `
      <div class="pinlock">
        <h1 style="margin:0">Ledger</h1>
        <p class="muted" style="margin-top:-0.75rem">${m === "signup" ? "Create your account" : m === "forgot" ? "Reset your password" : "Sign in"}</p>
        ${viewAuth.error ? `<p class="text-debit" style="font-size:0.85rem">${escapeHtml(viewAuth.error)}</p>` : ""}
        <form id="auth-form" style="width:100%;max-width:320px">
          <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
          ${m !== "forgot" ? `<div class="field"><label>Password</label><input type="password" name="password" required minlength="6" autocomplete="${m === "signup" ? "new-password" : "current-password"}"></div>` : ""}
          <button type="submit" class="btn primary">${m === "signup" ? "Create account" : m === "forgot" ? "Send reset email" : "Sign in"}</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:0.4rem;align-items:center">
          ${m === "signin" ? `<button type="button" class="btn ghost" data-action="auth-mode" data-mode="forgot" style="width:auto">Forgot password?</button>
            <button type="button" class="btn ghost" data-action="auth-mode" data-mode="signup" style="width:auto">Create an account</button>` : ""}
          ${m === "signup" ? `<button type="button" class="btn ghost" data-action="auth-mode" data-mode="signin" style="width:auto">Already have an account? Sign in</button>` : ""}
          ${m === "forgot" ? `<button type="button" class="btn ghost" data-action="auth-mode" data-mode="signin" style="width:auto">Back to sign in</button>` : ""}
        </div>
      </div>
    `;
  },
};

function authErrorMessage(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Wrong password.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/network-request-failed": "Network error — check your connection.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return map[code] || err?.message || "Something went wrong.";
}

function wireAuth() {
  const root = $("#root");
  $("#auth-form", root).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get("email").trim();
    const password = fd.get("password");
    try {
      if (viewAuth.mode === "signup") await createUserWithEmailAndPassword(auth, email, password);
      else if (viewAuth.mode === "forgot") {
        await sendPasswordResetEmail(auth, email);
        viewAuth.error = "";
        toast("Password reset email sent.");
        viewAuth.mode = "signin"; renderCurrent(); return;
      } else await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      viewAuth.error = authErrorMessage(err);
      renderCurrent();
    }
  });
  $$("[data-action='auth-mode']", root).forEach((btn) => {
    btn.addEventListener("click", () => { viewAuth.mode = btn.dataset.mode; viewAuth.error = ""; renderCurrent(); });
  });
}

// ============================================================================
// PIN LOCK
// ============================================================================

function needsPinLock() {
  return !!S.settings.pinHash && !S.unlockedThisSession;
}

const viewPinLock = {
  entered: "",
  error: "",
  render() {
    return `
      <div class="pinlock">
        <h1 style="margin:0">Enter PIN</h1>
        ${viewPinLock.error ? `<p class="text-debit" style="font-size:0.85rem">${escapeHtml(viewPinLock.error)}</p>` : ""}
        <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<span class="${i < viewPinLock.entered.length ? "filled" : ""}"></span>`).join("")}</div>
        ${pinpadHtml()}
        <button type="button" class="btn ghost" style="width:auto" data-action="pin-signout">Sign out instead</button>
      </div>
    `;
  },
};
function pinpadHtml() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  return `<div class="pinpad">${keys.map((k) => k === "" ? `<button disabled></button>` :
    `<button type="button" data-action="pin-key" data-key="${k}">${k === "back" ? "⌫" : k}</button>`).join("")}</div>`;
}
function wirePinLock() {
  actions["pin-key"] = async (el) => {
    const key = el.dataset.key;
    if (key === "back") viewPinLock.entered = viewPinLock.entered.slice(0, -1);
    else if (viewPinLock.entered.length < 4) viewPinLock.entered += key;
    if (viewPinLock.entered.length === 4) {
      const hash = await sha256Hex(viewPinLock.entered);
      if (hash === S.settings.pinHash) {
        S.unlockedThisSession = true;
        viewPinLock.entered = ""; viewPinLock.error = "";
        renderCurrent();
        return;
      }
      viewPinLock.error = "Incorrect PIN.";
      viewPinLock.entered = "";
    }
    renderCurrent();
  };
  actions["pin-signout"] = () => signOut(auth);
}

// ============================================================================
// FIRESTORE SYNC
// ============================================================================

function uidPrefix() { return `users/${S.user.uid}/`; }

function attachListeners() {
  const uid = S.user.uid;
  const settingsDoc = doc(db, "users", uid, "settings", "app");
  S.unsubs.push(onSnapshot(settingsDoc, (snap) => {
    const data = snap.data() || {};
    S.settings = {
      theme: data.theme || "dark",
      pinHash: data.pinHash || null,
      defaultCurrency: data.defaultCurrency || "EUR",
      purgeDays: data.purgeDays || 30,
    };
    applyTheme(S.settings.theme);
    if (!S.purgeChecked) { S.purgeChecked = true; setTimeout(runAutoPurge, 3000); }
    renderCurrent();
  }, (err) => console.error("settings listener", err)));

  S.unsubs.push(onSnapshot(collection(db, "users", uid, "people"), (snap) => {
    S.people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCurrent();
  }, (err) => console.error("people listener", err)));

  S.unsubs.push(onSnapshot(query(collectionGroup(db, "txns"), where("uid", "==", uid)), (snap) => {
    S.txns = snap.docs
      .filter((d) => d.ref.path.startsWith(uidPrefix()))
      .map((d) => ({ id: d.id, personId: d.ref.parent.parent.id, ...d.data() }));
    renderCurrent();
  }, (err) => console.error("txns listener", err)));

  S.unsubs.push(onSnapshot(collection(db, "users", uid, "accounts"), (snap) => {
    S.accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCurrent();
  }, (err) => console.error("accounts listener", err)));

  S.unsubs.push(onSnapshot(query(collectionGroup(db, "entries"), where("uid", "==", uid)), (snap) => {
    S.entries = snap.docs
      .filter((d) => d.ref.path.startsWith(uidPrefix()))
      .map((d) => ({ id: d.id, accountId: d.ref.parent.parent.id, ...d.data() }));
    renderCurrent();
  }, (err) => console.error("entries listener", err)));

  S.unsubs.push(onSnapshot(collection(db, "users", uid, "investments"), (snap) => {
    S.investments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCurrent();
  }, (err) => console.error("investments listener", err)));

  S.unsubs.push(onSnapshot(query(collectionGroup(db, "balances"), where("uid", "==", uid)), (snap) => {
    S.balances = snap.docs
      .filter((d) => d.ref.path.startsWith(uidPrefix()))
      .map((d) => ({ id: d.id, investmentId: d.ref.parent.parent.id, ...d.data() }));
    renderCurrent();
  }, (err) => console.error("balances listener", err)));

}

function detachListeners() {
  S.unsubs.forEach((u) => u());
  S.unsubs = [];
  S.people = []; S.txns = []; S.accounts = []; S.entries = []; S.investments = []; S.balances = [];
  S.settings = { theme: "dark", pinHash: null, defaultCurrency: "EUR", purgeDays: 30 };
  S.unlockedThisSession = false;
  S.purgeChecked = false;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ledger:theme", theme);
}

// ============================================================================
// PEOPLE + LOANS
// ============================================================================

const peopleUi = { search: "", tag: "", sort: "balance" };

function viewPeopleList() {
  let people = activePeople();
  if (peopleUi.search) {
    const q = peopleUi.search.toLowerCase();
    people = people.filter((p) => p.name.toLowerCase().includes(q));
  }
  if (peopleUi.tag) people = people.filter((p) => (p.tags || []).includes(peopleUi.tag));

  const withNet = people.map((p) => ({ p, primary: personPrimaryCurrency(p.id) }));
  if (peopleUi.sort === "balance") withNet.sort((a, b) => Math.abs(b.primary.amount) - Math.abs(a.primary.amount));
  else if (peopleUi.sort === "az") withNet.sort((a, b) => a.p.name.localeCompare(b.p.name));
  else if (peopleUi.sort === "newest") withNet.sort((a, b) => b.p.createdAt - a.p.createdAt);

  const rows = withNet.map(({ p, primary }) => {
    const dir = directionOf(primary.amount);
    const label = dir === "credit" ? "owes you" : dir === "debit" ? "you owe" : "settled";
    return `
      <a class="row" href="#/person/${p.id}">
        <div class="avatar">${escapeHtml(initials(p.name))}</div>
        <div class="main">
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="sub"><span class="dot ${dir}"></span>${label}${p.tags?.[0] ? ` · ${escapeHtml(p.tags[0])}` : ""}</div>
        </div>
        <div class="amount ${dir}">
          ${primary.amount === 0 ? "—" : fmtMoney(Math.abs(primary.amount), primary.ccy)}
          ${primary.extra ? `<span class="hint">+${primary.extra} ccy</span>` : ""}
        </div>
      </a>`;
  }).join("") || `<div class="empty"><div class="icon">🧑‍🤝‍🧑</div><p>No people yet.<br>Add the first person you lend to or borrow from.</p></div>`;

  const content = `
    <div class="field">
      <input type="search" placeholder="Search people" value="${escapeHtml(peopleUi.search)}" data-action="people-search">
    </div>
    <div class="chip-group" style="margin-bottom:0.5rem">
      <button type="button" class="chip ${!peopleUi.tag ? "active" : ""}" data-action="people-tag" data-tag="">All</button>
      ${PEOPLE_TAGS.map((t) => `<button type="button" class="chip ${peopleUi.tag === t ? "active" : ""}" data-action="people-tag" data-tag="${t}">${t}</button>`).join("")}
    </div>
    <div class="chip-group" style="margin-bottom:1rem">
      ${[["balance", "Balance"], ["az", "A–Z"], ["newest", "Newest"]].map(([k, l]) =>
        `<button type="button" class="chip ${peopleUi.sort === k ? "active" : ""}" data-action="people-sort" data-sort="${k}">${l}</button>`).join("")}
    </div>
    <div class="card" style="padding:0.3rem 1rem">${rows}</div>
  `;
  return renderShell({ title: "People", tab: "people", content, fab: "quick-add" });
}

function wirePeopleListEvents() {
  actions["people-search"] = () => {}; // handled via input event below
  actions["people-tag"] = (el) => { peopleUi.tag = el.dataset.tag; renderCurrent(); };
  actions["people-sort"] = (el) => { peopleUi.sort = el.dataset.sort; renderCurrent(); };
}
wirePeopleListEvents();

actions["add-person"] = () => openPersonForm();
function openPersonForm(person) {
  const tags = person?.tags || [];
  openSheet(`
    <h2>${person ? "Edit person" : "Add person"}</h2>
    <form id="person-form">
      <div class="field"><label>Name</label><input name="name" required value="${escapeHtml(person?.name || "")}"></div>
      <div class="field"><label>Contact (optional)</label><input name="contact" value="${escapeHtml(person?.contact || "")}"></div>
      <div class="field">
        <label>Tags</label>
        <div class="chip-group">
          ${PEOPLE_TAGS.map((t) => `<button type="button" class="chip ${tags.includes(t) ? "active" : ""}" data-tag-toggle="${t}">${t}</button>`).join("")}
        </div>
        <input type="hidden" name="tags" value="${escapeHtml(tags.join(","))}">
      </div>
      <div class="field"><label>Note (optional)</label><textarea name="note">${escapeHtml(person?.note || "")}</textarea></div>
      <button type="submit" class="btn primary">${person ? "Save" : "Add person"}</button>
    </form>
  `, {
    onMount: (root) => {
      $$("[data-tag-toggle]", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          const hidden = $("input[name=tags]", root);
          const set = new Set(hidden.value.split(",").filter(Boolean));
          const t = btn.dataset.tagToggle;
          if (set.has(t)) set.delete(t); else set.add(t);
          hidden.value = Array.from(set).join(",");
          btn.classList.toggle("active");
        });
      });
    },
    onSubmit: async (fd) => {
      const data = {
        name: fd.get("name").trim(),
        contact: fd.get("contact").trim(),
        tags: fd.get("tags") ? fd.get("tags").split(",").filter(Boolean) : [],
        note: fd.get("note").trim(),
      };
      if (person) await updateDoc(doc(db, "users", S.user.uid, "people", person.id), data);
      else await addDoc(collection(db, "users", S.user.uid, "people"), { ...data, createdAt: Date.now(), deletedAt: null });
      closeSheet();
      toast(person ? "Person updated." : "Person added.");
    },
  });
}

function viewPersonDetail(pid) {
  const p = S.people.find((x) => x.id === pid);
  if (!p) return renderShell({ title: "Not found", back: "#/people", content: `<div class="empty">This person isn't here.</div>` });

  const txns = personTxns(pid).sort((a, b) => b.createdAt - a.createdAt);
  const net = personNet(pid);

  const rows = txns.map((t) => {
    const remaining = txnRemaining(t);
    const settled = t.status === "settled";
    const dir = t.type === "lent" ? "credit" : "debit";
    return `
      <a class="row" href="#/txn/${pid}/${t.id}">
        <div class="main">
          <div class="title">${escapeHtml(t.description || (t.type === "lent" ? "Lent" : "Borrowed"))}</div>
          <div class="sub">${fmtDate(t.createdAt)} ${settled ? "· settled" : isOverdue(t) ? "· overdue" : ""}</div>
        </div>
        <div class="amount ${settled ? "settled" : dir}">${fmtMoney(settled ? t.principal : remaining, t.currency)}</div>
      </a>`;
  }).join("") || `<div class="empty"><div class="icon">📄</div><p>No loan entries yet.</p></div>`;

  const content = `
    <div class="card">
      <div class="row" style="border:none;padding:0">
        <div class="avatar" style="width:52px;height:52px;font-size:1.1rem">${escapeHtml(initials(p.name))}</div>
        <div class="main">
          <div class="title" style="font-size:1.1rem">${escapeHtml(p.name)}</div>
          <div class="sub">${p.contact ? escapeHtml(p.contact) : ""} ${p.tags?.length ? "· " + p.tags.map(escapeHtml).join(", ") : ""}</div>
        </div>
      </div>
      ${p.note ? `<p class="muted" style="margin:0.75rem 0 0">${escapeHtml(p.note)}</p>` : ""}
      <div class="btn-row" style="margin-top:1rem">
        <button type="button" class="btn ghost" data-action="edit-person" data-pid="${p.id}">Edit</button>
        <button type="button" class="btn danger" data-action="trash-person" data-pid="${p.id}">Trash</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="card stat"><div class="label">They owe you</div><div class="value text-credit">${currencyRows(Object.fromEntries(Object.entries(net).filter(([, v]) => v > 0)), { emptyLabel: "—" })}</div></div>
      <div class="card stat"><div class="label">You owe them</div><div class="value text-debit">${currencyRows(Object.fromEntries(Object.entries(net).filter(([, v]) => v < 0).map(([k, v]) => [k, -v])), { emptyLabel: "—" })}</div></div>
    </div>

    <div class="btn-row" style="margin:1rem 0">
      <button type="button" class="btn" style="background:var(--credit-dim);color:var(--credit);border-color:var(--credit)" data-action="add-loan" data-pid="${p.id}" data-type="lent">I lent</button>
      <button type="button" class="btn" style="background:var(--debit-dim);color:var(--debit);border-color:var(--debit)" data-action="add-loan" data-pid="${p.id}" data-type="borrowed">I borrowed</button>
    </div>

    <button type="button" class="btn ghost" style="margin-bottom:1rem" data-action="export-person-pdf" data-pid="${p.id}">Export statement (PDF)</button>

    <div class="section-title">Loan entries</div>
    <div class="card" style="padding:0.3rem 1rem">${rows}</div>
  `;
  return renderShell({ title: p.name, back: "#/people", content });
}

actions["edit-person"] = (el) => openPersonForm(S.people.find((p) => p.id === el.dataset.pid));
actions["trash-person"] = async (el) => {
  const pid = el.dataset.pid;
  await updateDoc(doc(db, "users", S.user.uid, "people", pid), { deletedAt: Date.now() });
  navigate("#/people");
  toast("Person moved to Trash.", { actionLabel: "Undo", onAction: () => updateDoc(doc(db, "users", S.user.uid, "people", pid), { deletedAt: null }) });
};
actions["add-loan"] = (el) => openLoanForm(el.dataset.pid, null, el.dataset.type);

function openLoanForm(pid, txn, initialType, initialCurrency) {
  const type = txn?.type || initialType || "lent";
  const currency = initialCurrency || txn?.currency || S.settings.defaultCurrency;
  // Creating a loan requires an account (§6) — the money really moves. Editing
  // an existing loan doesn't re-ask; only the original creation is tied to one.
  const matchingAccounts = activeAccounts().filter((a) => a.currency === currency);
  openSheet(`
    <h2>${txn ? "Edit loan entry" : "New loan entry"}</h2>
    <form id="loan-form">
      <div class="field">
        <div class="toggle-group">
          <button type="button" data-type-toggle="lent" class="${type === "lent" ? "active lent" : ""}">I lent</button>
          <button type="button" data-type-toggle="borrowed" class="${type === "borrowed" ? "active borrowed" : ""}">I borrowed</button>
        </div>
        <input type="hidden" name="type" value="${type}">
      </div>
      <div class="field">
        <label>Currency</label>
        <select name="currency" id="loan-currency-select">${CURRENCY_CODES.map((c) => `<option value="${c}" ${currency === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" min="0.01" name="principal" required value="${txn?.principal ?? ""}"></div>
      <div class="field"><label>Description (optional)</label><input name="description" value="${escapeHtml(txn?.description || "")}"></div>
      ${!txn ? `
        <div class="field">
          <label>Which account?</label>
          ${matchingAccounts.length
            ? `<select name="accountId">${matchingAccounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select>`
            : `<p class="text-debit" style="font-size:0.85rem">No ${currency} accounts yet — add one in Wallet first, then come back.</p>`}
        </div>` : ""}
      <div class="field"><label>Date &amp; time</label><input type="datetime-local" name="createdAt" value="${toDateTimeLocal(txn?.createdAt || Date.now())}"></div>
      <div class="field"><label>Due date (optional)</label><input type="date" name="dueDate" value="${txn?.dueDate || ""}"></div>
      <button type="submit" class="btn primary" ${!txn && !matchingAccounts.length ? "disabled" : ""}>${txn ? "Save" : "Add entry"}</button>
    </form>
  `, {
    onMount: (root) => {
      $$("[data-type-toggle]", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          $$("[data-type-toggle]", root).forEach((b) => b.classList.remove("active", "lent", "borrowed"));
          btn.classList.add("active", btn.dataset.typeToggle);
          $("input[name=type]", root).value = btn.dataset.typeToggle;
        });
      });
      $("#loan-currency-select", root)?.addEventListener("change", (e) => {
        openLoanForm(pid, txn, $("input[name=type]", root).value, e.target.value);
      });
    },
    onSubmit: async (fd) => {
      const at = new Date(fd.get("createdAt")).getTime();
      const data = {
        type: fd.get("type"),
        currency: fd.get("currency"),
        principal: parseFloat(fd.get("principal")),
        description: fd.get("description").trim(),
        createdAt: at,
        dueDate: fd.get("dueDate") || null,
      };
      if (txn) {
        const changes = [];
        if (txn.principal !== data.principal) changes.push(`amount ${fmtMoney(txn.principal, txn.currency)} → ${fmtMoney(data.principal, data.currency)}`);
        if (txn.currency !== data.currency) changes.push(`currency ${txn.currency} → ${data.currency}`);
        if ((txn.description || "") !== data.description) changes.push(`description updated`);
        if ((txn.dueDate || null) !== data.dueDate) changes.push(`due date ${txn.dueDate || "none"} → ${data.dueDate || "none"}`);
        const history = [...(txn.history || []), { at: Date.now(), text: changes.length ? `Edited: ${changes.join(", ")}` : "Edited" }];
        await updateDoc(doc(db, "users", S.user.uid, "people", pid, "txns", txn.id), { ...data, history });
        closeSheet();
        toast("Loan entry updated.");
        return;
      }
      const accountId = fd.get("accountId");
      if (!accountId) { toast(`Add a ${data.currency} account first, then try again.`); return; }
      const person = S.people.find((p) => p.id === pid);
      await addDoc(collection(db, "users", S.user.uid, "people", pid, "txns"), {
        ...data, status: "open", payments: [], accountId,
        history: [{ at: Date.now(), text: `Created (${data.type === "lent" ? "lent" : "borrowed"} ${fmtMoney(data.principal, data.currency)})` }],
        deletedAt: null,
        uid: S.user.uid,
      });
      closeSheet();
      // Borrowing brings money to you (deposit); lending sends it out (expense).
      const isIncoming = data.type === "borrowed";
      saveAccountEntry(accountId, {
        type: isIncoming ? "deposit" : "expense",
        amount: data.principal,
        description: `${data.type === "lent" ? "Lent to" : "Borrowed from"} ${person?.name || ""}`,
        category: "Other",
        at: data.createdAt,
        createdAt: Date.now(),
      });
    },
  });
}

function viewTxnDetail(pid, tid) {
  const p = S.people.find((x) => x.id === pid);
  const t = S.txns.find((x) => x.id === tid && x.personId === pid);
  if (!p || !t) return renderShell({ title: "Not found", back: `#/person/${pid}`, content: `<div class="empty">This entry isn't here.</div>` });

  const remaining = txnRemaining(t);
  const paid = txnPaid(t);
  const dir = t.type === "lent" ? "credit" : "debit";
  const overpaid = remaining < -0.005;
  const pct = Math.min(100, Math.max(0, (paid / t.principal) * 100));

  const timeline = [
    { at: t.createdAt, text: `Started · ${fmtMoney(t.principal, t.currency)}`, note: t.description },
    ...(t.payments || []).map((pay) => ({ at: pay.at, text: `Payment · ${fmtMoney(pay.amount, t.currency)}`, note: pay.note })),
  ].sort((a, b) => b.at - a.at);

  const content = `
    <div class="card">
      <div class="label muted">${t.type === "lent" ? `${escapeHtml(p.name)} owes you` : `You owe ${escapeHtml(p.name)}`}</div>
      <div class="amount ${overpaid ? "credit" : dir}" style="font-size:1.8rem;font-weight:700">
        ${overpaid ? `Overpaid by ${fmtMoney(Math.abs(remaining), t.currency)}` : fmtMoney(Math.max(0, remaining), t.currency)}
      </div>
      <div class="muted" style="font-size:0.85rem;margin:0.35rem 0 0.75rem">Paid ${fmtMoney(paid, t.currency)} of ${fmtMoney(t.principal, t.currency)}</div>
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
      ${t.description ? `<p style="margin:0.9rem 0 0">${escapeHtml(t.description)}</p>` : ""}
      <p class="muted" style="font-size:0.8rem;margin:0.5rem 0 0">Started ${fmtDateTime(t.createdAt)}${t.dueDate ? ` · Due ${fmtDate(new Date(t.dueDate).getTime())}` : ""}</p>
    </div>

    ${t.status === "open" && remaining > 0 ? `
      <div class="card">
        <h2>Record a payment</h2>
        <input type="range" min="0" max="${remaining}" step="0.01" value="0" id="pay-slider" style="width:100%">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin:0.4rem 0 0.9rem">
          <span class="muted">Amount</span><b id="pay-amount">${fmtMoney(0, t.currency)}</b>
        </div>
        <div class="btn-row">
          <button type="button" class="btn ghost" data-action="pay-full" data-pid="${pid}" data-tid="${tid}" data-remaining="${remaining}">Pay full</button>
          <button type="button" class="btn primary" data-action="open-pay-sheet" data-pid="${pid}" data-tid="${tid}" data-remaining="${remaining}">Record payment</button>
        </div>
      </div>` : ""}

    <div class="btn-row" style="margin-bottom:1rem">
      <button type="button" class="btn ghost" data-action="toggle-settle" data-pid="${pid}" data-tid="${tid}" data-status="${t.status}">${t.status === "settled" ? "Reopen" : "Mark settled"}</button>
      <button type="button" class="btn ghost" data-action="edit-loan" data-pid="${pid}" data-tid="${tid}">Edit</button>
      <button type="button" class="btn danger" data-action="trash-loan" data-pid="${pid}" data-tid="${tid}">Trash</button>
    </div>

    <div class="section-title">History</div>
    <div class="card">
      ${timeline.map((item) => `
        <div class="timeline-item">
          <div class="when">${fmtDate(item.at)}</div>
          <div class="main"><div>${item.text}</div>${item.note ? `<div class="muted" style="font-size:0.78rem">${escapeHtml(item.note)}</div>` : ""}</div>
        </div>
      `).join("")}
    </div>
  `;
  return renderShell({ title: "Loan entry", back: `#/person/${pid}`, content });
}

function wireTxnDetailSlider() {
  const slider = $("#pay-slider");
  if (!slider) return;
  slider.addEventListener("input", () => {
    const t = S.txns.find((x) => x.id === parseHash().params[1]);
    $("#pay-amount").textContent = fmtMoney(parseFloat(slider.value), t?.currency || "EUR");
  });
}

actions["edit-loan"] = (el) => openLoanForm(el.dataset.pid, S.txns.find((t) => t.id === el.dataset.tid));
actions["trash-loan"] = async (el) => {
  const { pid, tid } = el.dataset;
  await updateDoc(doc(db, "users", S.user.uid, "people", pid, "txns", tid), { deletedAt: Date.now() });
  navigate(`#/person/${pid}`);
  toast("Loan entry moved to Trash.", { actionLabel: "Undo", onAction: () => updateDoc(doc(db, "users", S.user.uid, "people", pid, "txns", tid), { deletedAt: null }) });
};
actions["toggle-settle"] = async (el) => {
  const { pid, tid, status } = el.dataset;
  const t = S.txns.find((x) => x.id === tid);
  const newStatus = status === "settled" ? "open" : "settled";
  const history = [...(t.history || []), { at: Date.now(), text: newStatus === "settled" ? "Marked settled" : "Reopened" }];
  await updateDoc(doc(db, "users", S.user.uid, "people", pid, "txns", tid), { status: newStatus, history });
};
actions["pay-full"] = (el) => actions["open-pay-sheet"](el);
actions["open-pay-sheet"] = (el) => {
  const { pid, tid, remaining } = el.dataset;
  const t = S.txns.find((x) => x.id === tid);
  const slider = $("#pay-slider");
  const amount = slider ? parseFloat(slider.value) || 0 : 0;
  // Repayment requires an account too (§6) — real cash moves either way.
  const matchingAccounts = activeAccounts().filter((a) => a.currency === t.currency);
  openSheet(`
    <h2>Record payment</h2>
    <form id="pay-form">
      <div class="field"><label>Amount (remaining ${fmtMoney(parseFloat(remaining), t.currency)})</label>
        <input type="number" step="0.01" min="0.01" name="amount" required value="${amount || parseFloat(remaining)}"></div>
      <div class="field">
        <label>Which account?</label>
        ${matchingAccounts.length
          ? `<select name="accountId">${matchingAccounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select>`
          : `<p class="text-debit" style="font-size:0.85rem">No ${t.currency} accounts yet — add one in Wallet first, then come back.</p>`}
      </div>
      <div class="field"><label>Note (optional)</label><input name="note"></div>
      <button type="submit" class="btn primary" ${!matchingAccounts.length ? "disabled" : ""}>Record payment</button>
    </form>
  `, {
    onSubmit: async (fd) => {
      const accountId = fd.get("accountId");
      if (!accountId) { toast(`Add a ${t.currency} account first, then try again.`); return; }
      closeSheet();
      await recordPayment(pid, tid, parseFloat(fd.get("amount")), fd.get("note").trim(), accountId);
    },
  });
};
async function recordPayment(pid, tid, amount, note, accountId) {
  const t = S.txns.find((x) => x.id === tid);
  const payment = { id: crypto.randomUUID(), amount, at: Date.now(), note };
  const payments = [...(t.payments || []), payment];
  const remaining = t.principal - payments.reduce((s, p) => s + p.amount, 0);
  const history = [...(t.history || []), { at: Date.now(), text: `Payment recorded · ${fmtMoney(amount, t.currency)}` }];
  const patch = { payments, history };
  if (remaining <= 0 && t.status === "open") { patch.status = "settled"; history.push({ at: Date.now(), text: "Auto-settled (fully paid)" }); }
  await updateDoc(doc(db, "users", S.user.uid, "people", pid, "txns", tid), patch);
  // Being repaid on a loan you gave brings money to you (deposit); paying
  // someone back on a loan you took sends it out (expense).
  const person = S.people.find((p) => p.id === pid);
  const isIncoming = t.type === "lent";
  saveAccountEntry(accountId, {
    type: isIncoming ? "deposit" : "expense",
    amount,
    description: `${t.type === "lent" ? "Repaid by" : "Repaid to"} ${person?.name || ""}`,
    category: "Other",
    at: Date.now(),
    createdAt: Date.now(),
  });
}

// ============================================================================
// QUICK ADD (FAB)
// ============================================================================

actions["quick-add"] = () => {
  const people = activePeople().sort((a, b) => a.name.localeCompare(b.name));
  openSheet(`
    <h2>Add</h2>
    <button type="button" class="btn primary" style="margin-bottom:0.6rem" data-action="qa-txn">+ Add transaction</button>
    <button type="button" class="btn ghost" style="margin-bottom:0.6rem" data-action="qa-person">+ New person</button>
    <button type="button" class="btn ghost" style="margin-bottom:0.6rem" data-action="qa-account">+ New account / card</button>
    <button type="button" class="btn ghost" style="margin-bottom:0.6rem" data-action="qa-investment">+ New investment platform</button>
    ${people.length ? `
      <div class="section-title">Loan entry for…</div>
      <div class="card" style="padding:0.3rem 1rem;max-height:240px;overflow-y:auto">
        ${people.map((p) => `<button type="button" class="row" style="width:100%;background:none;border:none;text-align:left" data-action="qa-loan-for" data-pid="${p.id}">
          <div class="avatar">${escapeHtml(initials(p.name))}</div><div class="main title">${escapeHtml(p.name)}</div>
        </button>`).join("")}
      </div>` : ""}
  `);
};
actions["qa-txn"] = () => { closeSheet(); openAddTransactionForm(); };
actions["qa-person"] = () => { closeSheet(); openPersonForm(); };
actions["qa-account"] = () => { closeSheet(); openAccountForm(); };
actions["qa-investment"] = () => { closeSheet(); openInvestmentForm(); };
actions["qa-loan-for"] = (el) => { closeSheet(); openLoanForm(el.dataset.pid, null, "lent"); };

// ============================================================================
// DASHBOARD (HOME)
// ============================================================================

function viewHome() {
  const { owedToYou, youOwe } = totalsByDirection();
  const net = {};
  for (const c of CURRENCY_CODES) {
    const v = (owedToYou[c] || 0) - (youOwe[c] || 0);
    if (Math.abs(v) > 0.005) net[c] = v;
  }
  const allSettled = !Object.keys(owedToYou).length && !Object.keys(youOwe).length;

  const overdue = S.txns.filter(isOverdue);
  const stale = S.txns.filter((t) => isStale(t) && !isOverdue(t));
  const attention = [...overdue, ...stale].slice(0, 6);

  const topBalances = activePeople()
    .map((p) => ({ p, primary: personPrimaryCurrency(p.id) }))
    .filter((x) => Math.abs(x.primary.amount) > 0.005)
    .sort((a, b) => Math.abs(b.primary.amount) - Math.abs(a.primary.amount))
    .slice(0, 5);

  const onHand = walletOnHand();
  const dueSoonCards = activeAccounts().filter((a) => a.kind === "card" && isCardDueSoon(a));

  const content = `
    <div class="card">
      <h2>Net position</h2>
      ${allSettled ? `<p class="muted" style="margin:0">All settled.</p>` : `<div class="stat-grid">${currencyRows(net, { colorClass: (v) => (v > 0 ? "text-credit" : v < 0 ? "text-debit" : "text-settled") })}</div>`}
      <p class="muted" style="font-size:0.75rem;margin:0.75rem 0 0">Owed to you: ${Object.entries(owedToYou).map(([c, v]) => fmtMoney(v, c)).join(", ") || "—"} · You owe: ${Object.entries(youOwe).map(([c, v]) => fmtMoney(v, c)).join(", ") || "—"}</p>
      <p class="muted" style="font-size:0.7rem;margin:0.35rem 0 0">Currencies are never added together.</p>
    </div>

    ${attention.length ? `
      <div class="section-title">Needs attention</div>
      <div class="card" style="padding:0.3rem 1rem">
        ${attention.map((t) => {
          const p = S.people.find((x) => x.id === t.personId);
          const overdueFlag = isOverdue(t);
          return `<a class="row" href="#/txn/${t.personId}/${t.id}">
            <div class="main">
              <div class="title">${escapeHtml(p?.name || "Unknown")}</div>
              <div class="sub"><span class="dot ${overdueFlag ? "debit" : "settled"}"></span>${overdueFlag ? "Overdue" : "No activity in 30+ days"}</div>
            </div>
            <div class="amount ${t.type === "lent" ? "credit" : "debit"}">${fmtMoney(txnRemaining(t), t.currency)}</div>
          </a>`;
        }).join("")}
      </div>` : ""}

    ${topBalances.length ? `
      <div class="section-title">Top balances</div>
      <div class="card" style="padding:0.3rem 1rem">
        ${topBalances.map(({ p, primary }) => `<a class="row" href="#/person/${p.id}">
          <div class="avatar">${escapeHtml(initials(p.name))}</div>
          <div class="main title">${escapeHtml(p.name)}</div>
          <div class="amount ${directionOf(primary.amount)}">${fmtMoney(Math.abs(primary.amount), primary.ccy)}</div>
        </a>`).join("")}
      </div>` : ""}

    <div class="section-title">Your money</div>
    <a class="card" href="#/wallet" style="display:block;text-decoration:none;color:inherit">
      <div class="stat-grid">${currencyRows(onHand, { emptyLabel: "No accounts yet" })}</div>
      ${dueSoonCards.length ? `<p class="text-debit" style="font-size:0.8rem;margin:0.75rem 0 0">${dueSoonCards.length} card repayment${dueSoonCards.length > 1 ? "s" : ""} due soon</p>` : ""}
      <p class="muted" style="font-size:0.75rem;margin:0.5rem 0 0">Cash + bank on hand · separate from loans →</p>
    </a>

    <button type="button" class="btn ghost" style="margin-bottom:1rem" data-action="qa-txn">+ Add transaction</button>

    ${activePeople().length === 0 ? `<div class="empty"><div class="icon">👋</div><p>Add your first person to start tracking loans.</p></div>` : ""}
  `;
  return renderShell({ title: "Ledger", tab: "", content, fab: "quick-add" });
}

actions["export-person-pdf"] = (el) => exportPersonStatementPdf(el.dataset.pid);

// ============================================================================
// WALLET: cash / bank accounts + ledger, credit cards
// ============================================================================

function viewWallet() {
  const onHand = walletOnHand();
  const cardDebt = walletCardDebt();
  const availCredit = walletAvailableCredit();
  const cash = activeAccounts().filter((a) => a.kind === "cash");
  const bank = activeAccounts().filter((a) => a.kind === "bank");
  const cards = activeAccounts().filter((a) => a.kind === "card")
    .sort((a, b) => (cardNextDue(a) || Infinity) - (cardNextDue(b) || Infinity));
  const investments = activeInvestments();
  const invValue = investmentsTotalValue();
  const invPL = investmentsTotalPL();

  const dueList = cards.filter((a) => accountBalance(a) > 0.005).sort((a, b) => (cardNextDue(a) || Infinity) - (cardNextDue(b) || Infinity));

  function accountRow(a) {
    const bal = accountBalance(a);
    return `<a class="row" href="#/account/${a.id}">
      <div class="avatar" style="color:var(--${a.kind}-tint)">${a.kind === "cash" ? "💵" : "🏦"}</div>
      <div class="main"><div class="title">${escapeHtml(a.name)}</div>${a.bank ? `<div class="sub">${escapeHtml(a.bank)}</div>` : ""}</div>
      <div class="amount ${bal < 0 ? "debit" : ""}">${fmtMoney(bal, a.currency)}</div>
    </a>`;
  }

  const content = `
    <div class="card">
      <h2>Money on hand</h2>
      <div class="stat-grid">${currencyRows(onHand, { emptyLabel: "No cash/bank accounts yet" })}</div>
    </div>

    ${(cards.length || investments.length) ? `
    <div class="stat-grid" style="margin-bottom:0.9rem">
      ${cards.length ? `<div class="card stat"><div class="label">Card debt</div><div class="value text-debit">${currencyRows(cardDebt, { emptyLabel: "—" })}</div></div>` : ""}
      ${cards.length ? `<div class="card stat"><div class="label">Available credit</div><div class="value text-credit">${currencyRows(availCredit, { emptyLabel: "—" })}</div></div>` : ""}
    </div>` : ""}

    ${dueList.length ? `
      <div class="section-title">Repayments due</div>
      <div class="card" style="padding:0.3rem 1rem">
        ${dueList.map((a) => {
          const due = cardNextDue(a);
          const soon = isCardDueSoon(a);
          return `<a class="row" href="#/account/${a.id}">
            <div class="main"><div class="title">${escapeHtml(a.name)}</div><div class="sub">${soon ? '<span class="dot debit"></span>' : ""}Due ${fmtDate(due)}</div></div>
            <div class="amount debit">${fmtMoney(accountBalance(a), a.currency)}</div>
          </a>`;
        }).join("")}
      </div>` : ""}

    <div class="section-title">Cash accounts</div>
    <div class="card" style="padding:0.3rem 1rem">${cash.map(accountRow).join("") || `<p class="muted" style="padding:0.5rem">None yet.</p>`}</div>

    <div class="section-title">Bank accounts</div>
    <div class="card" style="padding:0.3rem 1rem">${bank.map(accountRow).join("") || `<p class="muted" style="padding:0.5rem">None yet.</p>`}</div>

    <div class="section-title">Credit cards</div>
    ${cards.length ? cards.map(cardTile).join("") : `<div class="card"><p class="muted" style="margin:0">None yet.</p></div>`}

    <div class="section-title">Investments</div>
    ${investments.length ? `
      <div class="card">
        <div class="stat-grid">
          <div class="stat"><div class="label">Value</div><div class="value">${currencyRows(invValue, { emptyLabel: "—" })}</div></div>
          <div class="stat"><div class="label">Latest change</div><div class="value">${currencyRows(invPL, { emptyLabel: "—", colorClass: (v) => (v > 0 ? "text-credit" : v < 0 ? "text-debit" : "text-settled") })}</div></div>
        </div>
      </div>
      <div class="card" style="padding:0.3rem 1rem">
        ${investments.map((inv) => {
          const latest = investmentLatest(inv.id);
          const pl = investmentPL(inv.id);
          return `<a class="row" href="#/investment/${inv.id}">
            <div class="avatar">📈</div>
            <div class="main"><div class="title">${escapeHtml(inv.name)}</div><div class="sub">${latest ? `as of ${fmtDate(new Date(latest.date).getTime())}` : "no balance recorded yet"}</div></div>
            <div class="amount">
              ${latest ? fmtMoney(latest.amount, inv.currency) : "—"}
              ${latest ? `<span class="hint ${pl > 0 ? "text-credit" : pl < 0 ? "text-debit" : ""}">${pl === 0 ? "" : fmtSigned(pl, inv.currency)}</span>` : ""}
            </div>
          </a>`;
        }).join("")}
      </div>` : `<div class="card"><p class="muted" style="margin:0">No investment platforms yet — add Groww, Upstox, or any other you use.</p></div>`}
  `;
  return renderShell({ title: "Wallet", tab: "wallet", content, fab: "wallet-add" });
}

function cardTile(a) {
  const bal = accountBalance(a);
  const avail = cardAvailable(a);
  const due = cardNextDue(a);
  const soon = isCardDueSoon(a);
  const usagePct = a.limit ? Math.min(100, Math.max(0, (bal / a.limit) * 100)) : 0;
  return `
    <a class="card-tile" href="#/account/${a.id}" style="display:block;text-decoration:none;color:inherit">
      <div class="top">
        <div><div class="name">${escapeHtml(a.name)}</div><div class="issuer">${escapeHtml(a.bank || "")}</div></div>
        ${due ? `<div class="due ${soon ? "soon" : ""}">${soon ? "Due soon" : `Due ${fmtDate(due)}`}</div>` : ""}
      </div>
      <div class="usage-bar"><span style="width:${usagePct}%"></span></div>
      <div class="figures">
        <div>Outstanding<b class="${bal > 0 ? "text-debit" : ""}">${fmtMoney(bal, a.currency)}</b></div>
        <div>Available<b class="text-credit">${fmtMoney(avail, a.currency)}</b></div>
        <div>Limit<b>${fmtMoney(a.limit || 0, a.currency)}</b></div>
      </div>
      ${due ? `<p class="muted" style="font-size:0.75rem;margin:0.6rem 0 0">${daysBetween(Date.now(), due)} day${daysBetween(Date.now(), due) === 1 ? "" : "s"} until repayment</p>` : ""}
    </a>`;
}

actions["wallet-add"] = () => {
  openSheet(`
    <h2>Add to Wallet</h2>
    <button type="button" class="btn ghost" style="margin-bottom:0.6rem" data-action="qa-account-cash">+ Cash account</button>
    <button type="button" class="btn ghost" style="margin-bottom:0.6rem" data-action="qa-account-bank">+ Bank account</button>
    <button type="button" class="btn ghost" style="margin-bottom:0.6rem" data-action="qa-account-card">+ Credit card</button>
    <button type="button" class="btn ghost" data-action="qa-investment">+ Investment platform</button>
  `);
};
actions["qa-account-cash"] = () => { closeSheet(); openAccountForm(null, "cash"); };
actions["qa-account-bank"] = () => { closeSheet(); openAccountForm(null, "bank"); };
actions["qa-account-card"] = () => { closeSheet(); openAccountForm(null, "card"); };

function openAccountForm(account, initialKind) {
  const kind = account?.kind || initialKind || "cash";
  openSheet(`
    <h2>${account ? "Edit account" : kind === "card" ? "Add credit card" : `Add ${kind} account`}</h2>
    <form id="account-form">
      <input type="hidden" name="kind" value="${kind}">
      <div class="field"><label>Name</label><input name="name" required value="${escapeHtml(account?.name || "")}"></div>
      ${kind !== "cash" ? `<div class="field"><label>${kind === "card" ? "Issuer" : "Bank"}</label><input name="bank" value="${escapeHtml(account?.bank || "")}"></div>` : ""}
      <div class="field"><label>Currency</label><select name="currency">${CURRENCY_CODES.map((c) => `<option value="${c}" ${(account?.currency || S.settings.defaultCurrency) === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>${kind === "card" ? "Starting outstanding (optional)" : "Opening balance"}</label><input type="number" step="0.01" name="opening" value="${account?.opening ?? 0}"></div>
      ${kind === "card" ? `
        <div class="field"><label>Credit limit</label><input type="number" step="0.01" min="0" name="limit" required value="${account?.limit ?? ""}"></div>
        <div class="field"><label>Repayment due day (1–28)</label><input type="number" min="1" max="28" name="dueDay" required value="${account?.dueDay ?? ""}"></div>
      ` : ""}
      <div class="field"><label>Note (optional)</label><textarea name="note">${escapeHtml(account?.note || "")}</textarea></div>
      <button type="submit" class="btn primary">${account ? "Save" : "Add"}</button>
    </form>
  `, {
    onSubmit: async (fd) => {
      const data = {
        kind: fd.get("kind"),
        name: fd.get("name").trim(),
        bank: (fd.get("bank") || "").trim(),
        currency: fd.get("currency"),
        opening: parseFloat(fd.get("opening")) || 0,
        limit: kind === "card" ? parseFloat(fd.get("limit")) || 0 : null,
        dueDay: kind === "card" ? parseInt(fd.get("dueDay"), 10) : null,
        statementDay: account?.statementDay ?? null,
        note: (fd.get("note") || "").trim(),
      };
      if (account) await updateDoc(doc(db, "users", S.user.uid, "accounts", account.id), data);
      else await addDoc(collection(db, "users", S.user.uid, "accounts"), { ...data, createdAt: Date.now(), deletedAt: null });
      closeSheet();
      toast(account ? "Account updated." : "Account added.");
    },
  });
}

function viewAccountDetail(aid) {
  const a = S.accounts.find((x) => x.id === aid);
  if (!a) return renderShell({ title: "Not found", back: "#/wallet", content: `<div class="empty">This account isn't here.</div>` });

  const isCard = a.kind === "card";
  const bal = accountBalance(a);
  const entries = accountEntries(aid).slice().reverse();
  let running = bal;
  const rows = accountEntries(aid).slice().reverse().map((e) => {
    const rowRunning = running;
    running -= (isCard ? (e.type === "charge" ? e.amount : -e.amount) : (e.type === "deposit" ? e.amount : -e.amount));
    const positive = isCard ? e.type === "payment" : e.type === "deposit";
    return `
      <div class="row">
        <div class="main">
          <div class="title">${escapeHtml(e.description || (isCard ? (e.type === "charge" ? "Charge" : "Payment") : (e.type === "deposit" ? "Deposit" : "Expense")))}</div>
          <div class="sub">${fmtDateTime(e.at)}${e.category ? ` · ${escapeHtml(e.category)}` : ""}</div>
        </div>
        <div style="text-align:right">
          <div class="amount ${positive ? "credit" : "debit"}">${fmtSigned(positive ? Math.abs(e.amount) : -Math.abs(e.amount), a.currency)}</div>
          <div class="muted" style="font-size:0.72rem">${fmtMoney(rowRunning, a.currency)}</div>
        </div>
        <button type="button" class="icon-btn" data-action="delete-entry" data-aid="${aid}" data-eid="${e.id}" title="Delete">✕</button>
      </div>`;
  }).join("") || `<div class="empty"><div class="icon">📒</div><p>No activity yet.</p></div>`;

  const content = `
    <div class="card">
      <div class="label muted">${a.bank ? escapeHtml(a.bank) + " · " : ""}${a.kind === "card" ? "Credit card" : a.kind === "bank" ? "Bank account" : "Cash"}</div>
      <div class="amount ${bal < 0 ? "debit" : ""}" style="font-size:1.8rem;font-weight:700">${fmtMoney(bal, a.currency)}</div>
      ${isCard ? `<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0">Available credit: ${fmtMoney(cardAvailable(a), a.currency)} of ${fmtMoney(a.limit || 0, a.currency)}</p>` : ""}
      ${isCard && cardNextDue(a) ? `<p class="muted" style="font-size:0.85rem;margin:0.2rem 0 0">Next repayment due ${fmtDate(cardNextDue(a))}</p>` : ""}
      ${a.note ? `<p style="margin:0.75rem 0 0">${escapeHtml(a.note)}</p>` : ""}
      <div class="btn-row" style="margin-top:1rem">
        <button type="button" class="btn ghost" data-action="edit-account" data-aid="${a.id}">Edit</button>
        <button type="button" class="btn danger" data-action="trash-account" data-aid="${a.id}">Trash</button>
      </div>
    </div>

    <div class="btn-row" style="margin-bottom:1rem">
      <button type="button" class="btn" style="background:var(--credit-dim);color:var(--credit);border-color:var(--credit)" data-action="add-entry" data-aid="${a.id}" data-type="${isCard ? "payment" : "deposit"}">${isCard ? "Payment" : "Money in"}</button>
      <button type="button" class="btn" style="background:var(--debit-dim);color:var(--debit);border-color:var(--debit)" data-action="add-entry" data-aid="${a.id}" data-type="${isCard ? "charge" : "expense"}">${isCard ? "Charge" : "Money out"}</button>
    </div>

    <div class="section-title">Ledger</div>
    <div class="card" style="padding:0.3rem 1rem">${rows}</div>
  `;
  return renderShell({ title: a.name, back: "#/wallet", content });
}

actions["edit-account"] = (el) => openAccountForm(S.accounts.find((a) => a.id === el.dataset.aid));
actions["trash-account"] = async (el) => {
  const aid = el.dataset.aid;
  await updateDoc(doc(db, "users", S.user.uid, "accounts", aid), { deletedAt: Date.now() });
  navigate("#/wallet");
  toast("Account moved to Trash.", { actionLabel: "Undo", onAction: () => updateDoc(doc(db, "users", S.user.uid, "accounts", aid), { deletedAt: null }) });
};
actions["add-entry"] = (el) => openEntryForm(el.dataset.aid, el.dataset.type);
function openEntryForm(aid, type) {
  const a = S.accounts.find((x) => x.id === aid);
  const isCard = a.kind === "card";
  openSheet(`
    <h2>${type === "deposit" ? "Money in" : type === "expense" ? "Money out" : type === "payment" ? "Record payment" : "Record charge"}</h2>
    <form id="entry-form">
      <div class="field"><label>Amount</label><input type="number" step="0.01" min="0.01" name="amount" required></div>
      <div class="field"><label>Description</label><input name="description"></div>
      ${!isCard ? `<div class="field"><label>Category</label><select name="category">${ENTRY_CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Date &amp; time</label><input type="datetime-local" name="at" value="${toDateTimeLocal(Date.now())}"></div>
      <button type="submit" class="btn primary">Save</button>
    </form>
  `, {
    onSubmit: async (fd) => {
      const data = {
        type,
        amount: parseFloat(fd.get("amount")),
        description: (fd.get("description") || "").trim(),
        category: !isCard ? fd.get("category") : "",
        at: new Date(fd.get("at")).getTime(),
        createdAt: Date.now(),
      };
      closeSheet();
      saveAccountEntry(aid, data);
    },
  });
}
actions["delete-entry"] = async (el) => {
  const { aid, eid } = el.dataset;
  if (!confirm("Delete this entry? This can't be undone.")) return;
  await deleteDoc(doc(db, "users", S.user.uid, "accounts", aid, "entries", eid));
  toast("Entry deleted.");
};

// ============================================================================
// INVESTMENTS (STOCKS — Groww, Upstox, or any platform you add)
// ============================================================================
// One daily balance snapshot per platform. Profit/loss for a snapshot is
// simply that snapshot's balance minus the previous one — no separate
// deposit/withdrawal tracking, since the point is "what's it worth today".

function openInvestmentForm(inv) {
  openSheet(`
    <h2>${inv ? "Edit investment platform" : "Add investment platform"}</h2>
    <form id="investment-form">
      <div class="field">
        <label>Platform</label>
        <input name="name" required list="platform-suggestions" value="${escapeHtml(inv?.name || "")}" placeholder="Groww, Upstox, ...">
        <datalist id="platform-suggestions">${DEFAULT_INVESTMENT_PLATFORMS.map((p) => `<option value="${p}">`).join("")}</datalist>
      </div>
      <div class="field"><label>Currency</label><select name="currency">${CURRENCY_CODES.map((c) => `<option value="${c}" ${(inv?.currency || S.settings.defaultCurrency) === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>Note (optional)</label><textarea name="note">${escapeHtml(inv?.note || "")}</textarea></div>
      <button type="submit" class="btn primary">${inv ? "Save" : "Add"}</button>
    </form>
  `, {
    onSubmit: async (fd) => {
      const data = { name: fd.get("name").trim(), currency: fd.get("currency"), note: (fd.get("note") || "").trim() };
      if (inv) await updateDoc(doc(db, "users", S.user.uid, "investments", inv.id), data);
      else await addDoc(collection(db, "users", S.user.uid, "investments"), { ...data, createdAt: Date.now(), deletedAt: null });
      closeSheet();
      toast(inv ? "Platform updated." : "Platform added.");
    },
  });
}

function viewInvestmentDetail(iid) {
  const inv = S.investments.find((x) => x.id === iid);
  if (!inv) return renderShell({ title: "Not found", back: "#/wallet", content: `<div class="empty">This investment isn't here.</div>` });

  const balances = investmentBalances(iid).slice().reverse();
  const latest = balances[0] || null;
  const cumulativePL = investmentCumulativePL(iid);
  const dayPL = investmentPL(iid);

  const rows = investmentBalances(iid).slice().reverse().map((b, idx, arr) => {
    const prev = arr[idx + 1]; // next in reversed array = chronologically earlier
    const pl = prev ? b.amount - prev.amount : 0;
    return `
      <div class="row">
        <div class="main">
          <div class="title">${fmtDate(new Date(b.date).getTime())}</div>
          ${prev ? `<div class="sub ${pl > 0 ? "text-credit" : pl < 0 ? "text-debit" : ""}">${pl === 0 ? "No change" : fmtSigned(pl, inv.currency)}</div>` : `<div class="sub muted">First entry</div>`}
        </div>
        <div class="amount">${fmtMoney(b.amount, inv.currency)}</div>
        <button type="button" class="icon-btn" data-action="delete-balance" data-iid="${iid}" data-bid="${b.id}" title="Delete">✕</button>
      </div>`;
  }).join("") || `<div class="empty"><div class="icon">📈</div><p>No balances recorded yet. Enter today's balance to start tracking profit/loss.</p></div>`;

  const content = `
    <div class="card">
      <div class="label muted">${latest ? `As of ${fmtDate(new Date(latest.date).getTime())}` : "No balance yet"}</div>
      <div class="amount" style="font-size:1.8rem;font-weight:700">${latest ? fmtMoney(latest.amount, inv.currency) : "—"}</div>
      ${balances.length >= 2 ? `
        <div class="stat-grid" style="margin-top:0.9rem">
          <div class="stat"><div class="label">Latest change</div><div class="value ${dayPL > 0 ? "text-credit" : dayPL < 0 ? "text-debit" : "text-settled"}">${fmtSigned(dayPL, inv.currency)}</div></div>
          <div class="stat"><div class="label">Since first entry</div><div class="value ${cumulativePL > 0 ? "text-credit" : cumulativePL < 0 ? "text-debit" : "text-settled"}">${fmtSigned(cumulativePL, inv.currency)}</div></div>
        </div>` : ""}
      ${inv.note ? `<p style="margin:0.75rem 0 0">${escapeHtml(inv.note)}</p>` : ""}
      <div class="btn-row" style="margin-top:1rem">
        <button type="button" class="btn ghost" data-action="edit-investment" data-iid="${inv.id}">Edit</button>
        <button type="button" class="btn danger" data-action="trash-investment" data-iid="${inv.id}">Trash</button>
      </div>
    </div>

    <button type="button" class="btn primary" style="margin-bottom:1rem" data-action="add-balance" data-iid="${inv.id}">Enter today's balance</button>

    <div class="section-title">History</div>
    <div class="card" style="padding:0.3rem 1rem">${rows}</div>
  `;
  return renderShell({ title: inv.name, back: "#/wallet", content });
}

actions["edit-investment"] = (el) => openInvestmentForm(S.investments.find((i) => i.id === el.dataset.iid));
actions["trash-investment"] = async (el) => {
  const iid = el.dataset.iid;
  await updateDoc(doc(db, "users", S.user.uid, "investments", iid), { deletedAt: Date.now() });
  navigate("#/wallet");
  toast("Investment platform moved to Trash.", { actionLabel: "Undo", onAction: () => updateDoc(doc(db, "users", S.user.uid, "investments", iid), { deletedAt: null }) });
};
actions["add-balance"] = (el) => openBalanceForm(el.dataset.iid);
function openBalanceForm(iid) {
  const inv = S.investments.find((x) => x.id === iid);
  const today = toISODate(Date.now());
  const existingToday = investmentBalances(iid).find((b) => b.date === today);
  openSheet(`
    <h2>Enter balance — ${escapeHtml(inv.name)}</h2>
    <form id="balance-form">
      <div class="field"><label>Date</label><input type="date" name="date" value="${today}" required></div>
      <div class="field"><label>Balance (${inv.currency})</label><input type="number" step="0.01" min="0" name="amount" required value="${existingToday?.amount ?? ""}"></div>
      <button type="submit" class="btn primary">Save</button>
    </form>
    ${existingToday ? `<p class="muted" style="font-size:0.78rem;margin-top:0.6rem">You already logged a balance for today — saving will update it.</p>` : ""}
  `, {
    onSubmit: async (fd) => {
      const date = fd.get("date");
      const amount = parseFloat(fd.get("amount"));
      const existing = investmentBalances(iid).find((b) => b.date === date);
      if (existing) {
        await updateDoc(doc(db, "users", S.user.uid, "investments", iid, "balances", existing.id), { amount });
      } else {
        await addDoc(collection(db, "users", S.user.uid, "investments", iid, "balances"), { date, amount, createdAt: Date.now(), uid: S.user.uid });
      }
      closeSheet();
      toast("Balance saved.");
    },
  });
}
actions["delete-balance"] = async (el) => {
  const { iid, bid } = el.dataset;
  if (!confirm("Delete this balance entry?")) return;
  await deleteDoc(doc(db, "users", S.user.uid, "investments", iid, "balances", bid));
  toast("Balance entry deleted.");
};

// ============================================================================
// ADD TRANSACTION — the single entry point for logging money moving through
// a real account. Replaces the old standalone Notes feature entirely: there
// is no free-floating record anywhere in the app, everything requires an
// account. Reachable from the FAB (quick-add) from anywhere in the app.
// ============================================================================

function isCardKind(account) { return account?.kind === "card"; }

function openAddTransactionForm(preselectedAccountId) {
  const accounts = activeAccounts();
  if (!accounts.length) {
    toast("Add an account first — then you can record a transaction against it.");
    return;
  }
  const account = accounts.find((a) => a.id === preselectedAccountId) || accounts[0];
  const isCard = isCardKind(account);

  openSheet(`
    <h2>Add transaction</h2>
    <form id="add-txn-form">
      <div class="field">
        <label>Account</label>
        <select name="accountId" id="txn-account-select">
          ${accounts.map((a) => `<option value="${a.id}" ${a.id === account.id ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Type</label>
        <select name="type">
          ${isCard
            ? `<option value="charge">Charge</option><option value="payment">Payment</option>`
            : `<option value="expense">Money out</option><option value="deposit">Money in</option>`}
        </select>
      </div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" min="0.01" name="amount" required></div>
      <div class="field"><label>Description</label><input name="description" placeholder="e.g. Sent to father, Netflix"></div>
      ${!isCard ? `<div class="field"><label>Category</label><select name="category">${ENTRY_CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Date &amp; time</label><input type="datetime-local" name="at" value="${toDateTimeLocal(Date.now())}"></div>
      <button type="submit" class="btn primary">Save</button>
    </form>
  `, {
    onMount: (root) => {
      $("#txn-account-select", root).addEventListener("change", (e) => {
        openAddTransactionForm(e.target.value);
      });
    },
    onSubmit: async (fd) => {
      const aid = fd.get("accountId");
      const data = {
        type: fd.get("type"),
        amount: parseFloat(fd.get("amount")),
        description: (fd.get("description") || "").trim(),
        category: !isCard ? fd.get("category") : "",
        at: new Date(fd.get("at")).getTime(),
        createdAt: Date.now(),
      };
      closeSheet();
      saveAccountEntry(aid, data);
    },
  });
}

// Shared by Add Transaction and the account-detail "Money in/out" flow: asks
// the Income/Spending question when eligible (§7), then writes the entry.
function saveAccountEntry(aid, data) {
  const account = S.accounts.find((a) => a.id === aid);
  const isIncoming = data.type === "deposit" || data.type === "payment";
  withIncomeSpendingAnswer(account, data.category, isIncoming, async (answer) => {
    const finalData = { ...data, uid: S.user.uid };
    if (answer !== null) finalData.countedInIncomeSpending = answer;
    await addDoc(collection(db, "users", S.user.uid, "accounts", aid, "entries"), finalData);
    toast("Transaction recorded.");
  });
}

// ============================================================================
// TRASH & AUTO-PURGE
// ============================================================================

function trashedPeople() { return S.people.filter((p) => p.deletedAt); }
function trashedTxns() { return S.txns.filter((t) => t.deletedAt); }
function trashedAccounts() { return S.accounts.filter((a) => a.deletedAt); }
function trashedInvestments() { return S.investments.filter((i) => i.deletedAt); }
function trashCount() {
  return trashedPeople().length + trashedTxns().length + trashedAccounts().length + trashedInvestments().length;
}

function viewTrash() {
  const days = S.settings.purgeDays;
  const items = [
    ...trashedPeople().map((p) => ({ kind: "person", id: p.id, label: p.name, deletedAt: p.deletedAt, ref: ["people", p.id] })),
    ...trashedTxns().map((t) => ({ kind: "loan entry", id: t.id, label: `${S.people.find((p) => p.id === t.personId)?.name || "Unknown"} — ${fmtMoney(t.principal, t.currency)}`, deletedAt: t.deletedAt, ref: ["people", t.personId, "txns", t.id] })),
    ...trashedAccounts().map((a) => ({ kind: "account", id: a.id, label: a.name, deletedAt: a.deletedAt, ref: ["accounts", a.id] })),
    ...trashedInvestments().map((i) => ({ kind: "investment", id: i.id, label: i.name, deletedAt: i.deletedAt, ref: ["investments", i.id] })),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  const rows = items.map((it) => {
    const remaining = Math.max(0, days - daysBetween(it.deletedAt, Date.now()));
    return `
      <div class="row">
        <div class="main">
          <div class="title">${escapeHtml(it.label)}</div>
          <div class="sub">${it.kind} · ${remaining} day${remaining === 1 ? "" : "s"} left</div>
        </div>
        <div class="btn-row" style="flex:none">
          <button type="button" class="btn ghost" style="width:auto;padding:0.45rem 0.7rem" data-action="restore-trash" data-ref="${it.ref.join(",")}">Restore</button>
          <button type="button" class="btn danger" style="width:auto;padding:0.45rem 0.7rem" data-action="purge-trash" data-ref="${it.ref.join(",")}">Delete</button>
        </div>
      </div>`;
  }).join("") || `<div class="empty"><div class="icon">🗑️</div><p>Trash is empty.</p></div>`;

  const content = `
    <p class="muted" style="font-size:0.85rem">Items are permanently removed ${days} days after being trashed.</p>
    ${items.length ? `<button type="button" class="btn danger" style="margin-bottom:1rem" data-action="empty-trash">Empty trash now</button>` : ""}
    <div class="card" style="padding:0.3rem 1rem">${rows}</div>
  `;
  return renderShell({ title: "Trash", back: "#/settings", content });
}

function docRefFromParts(parts) { return doc(db, "users", S.user.uid, ...parts); }

actions["restore-trash"] = async (el) => {
  await updateDoc(docRefFromParts(el.dataset.ref.split(",")), { deletedAt: null });
  toast("Restored.");
};
actions["purge-trash"] = async (el) => {
  if (!confirm("Permanently delete this? This can't be undone.")) return;
  await purgeItem(el.dataset.ref.split(","));
  toast("Permanently deleted.");
};
actions["empty-trash"] = async () => {
  if (!confirm("Permanently delete everything in Trash? This can't be undone.")) return;
  const refs = [
    ...trashedPeople().map((p) => ["people", p.id]),
    ...trashedTxns().map((t) => ["people", t.personId, "txns", t.id]),
    ...trashedAccounts().map((a) => ["accounts", a.id]),
    ...trashedInvestments().map((i) => ["investments", i.id]),
  ];
  for (const r of refs) await purgeItem(r);
  toast("Trash emptied.");
};

async function purgeItem(parts) {
  // Purging a person also removes their txns subcollection; purging an
  // account/investment also removes its entries/balances subcollection.
  if (parts[0] === "people" && parts.length === 2) {
    const sub = await getDocs(collection(db, "users", S.user.uid, "people", parts[1], "txns"));
    const batch = writeBatch(db);
    sub.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "users", S.user.uid, "people", parts[1]));
    await batch.commit();
  } else if (parts[0] === "accounts" && parts.length === 2) {
    const sub = await getDocs(collection(db, "users", S.user.uid, "accounts", parts[1], "entries"));
    const batch = writeBatch(db);
    sub.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "users", S.user.uid, "accounts", parts[1]));
    await batch.commit();
  } else if (parts[0] === "investments" && parts.length === 2) {
    const sub = await getDocs(collection(db, "users", S.user.uid, "investments", parts[1], "balances"));
    const batch = writeBatch(db);
    sub.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "users", S.user.uid, "investments", parts[1]));
    await batch.commit();
  } else {
    await deleteDoc(docRefFromParts(parts));
  }
}

async function runAutoPurge() {
  const days = S.settings.purgeDays || 30;
  const cutoff = Date.now() - days * 86400000;
  const stalePeople = S.people.filter((p) => p.deletedAt && p.deletedAt < cutoff);
  const staleTxns = S.txns.filter((t) => t.deletedAt && t.deletedAt < cutoff);
  const staleAccounts = S.accounts.filter((a) => a.deletedAt && a.deletedAt < cutoff);
  const staleInvestments = S.investments.filter((i) => i.deletedAt && i.deletedAt < cutoff);
  for (const p of stalePeople) await purgeItem(["people", p.id]).catch(() => {});
  for (const t of staleTxns) await purgeItem(["people", t.personId, "txns", t.id]).catch(() => {});
  for (const a of staleAccounts) await purgeItem(["accounts", a.id]).catch(() => {});
  for (const i of staleInvestments) await purgeItem(["investments", i.id]).catch(() => {});
}

// ============================================================================
// REPORTS & EXPORTS
// ============================================================================

let _sheetJsPromise = null;
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve();
  if (!_sheetJsPromise) {
    _sheetJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return _sheetJsPromise;
}
let _jsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve();
  if (!_jsPdfPromise) {
    _jsPdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return _jsPdfPromise;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function loanRowsForExport() {
  return S.txns.filter((t) => !t.deletedAt).map((t) => {
    const p = S.people.find((x) => x.id === t.personId);
    return {
      person: p?.name || "Unknown",
      type: t.type,
      currency: t.currency,
      principal: t.principal,
      paid: txnPaid(t),
      remaining: txnRemaining(t),
      status: t.status,
      description: t.description || "",
      createdAt: fmtDate(t.createdAt),
      dueDate: t.dueDate || "",
    };
  });
}

function viewReports() {
  const { owedToYou, youOwe } = totalsByDirection();
  const codes = Array.from(new Set([...Object.keys(owedToYou), ...Object.keys(youOwe)]));
  const content = `
    <div class="section-title">Per-currency summary</div>
    ${codes.length ? codes.map((c) => `
      <div class="card">
        <h2>${c}</h2>
        <div class="stat-grid">
          <div class="stat"><div class="label">Owed to you</div><div class="value text-credit">${fmtMoney(owedToYou[c] || 0, c)}</div></div>
          <div class="stat"><div class="label">You owe</div><div class="value text-debit">${fmtMoney(youOwe[c] || 0, c)}</div></div>
        </div>
        <div class="divider"></div>
        <div class="stat"><div class="label">Net</div><div class="value">${fmtMoney((owedToYou[c] || 0) - (youOwe[c] || 0), c)}</div></div>
      </div>`).join("") : `<div class="card"><p class="muted" style="margin:0">No loan activity yet.</p></div>`}

    <div class="section-title">Export</div>
    <div class="card">
      <p class="muted" style="font-size:0.8rem;margin-top:0">Covers loan entries. CSV works offline; Excel and PDF need internet the first time (they fetch a small library).</p>
      <div class="btn-row" style="margin-bottom:0.6rem">
        <button type="button" class="btn ghost" data-action="export-csv">Export CSV</button>
        <button type="button" class="btn ghost" data-action="export-xlsx">Export Excel</button>
      </div>
      <button type="button" class="btn ghost" data-action="export-pdf">Export full report (PDF)</button>
    </div>
  `;
  return renderShell({ title: "Reports", tab: "reports", content });
}

actions["export-csv"] = () => {
  const rows = loanRowsForExport();
  const header = ["Person", "Type", "Currency", "Principal", "Paid", "Remaining", "Status", "Description", "Date", "Due date"];
  const lines = [header, ...rows.map((r) => [r.person, r.type, r.currency, r.principal, r.paid, r.remaining, r.status, r.description, r.createdAt, r.dueDate])];
  const csv = lines.map((l) => l.map(csvEscape).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `ledger-loans-${toISODate(Date.now())}.csv`);
  toast("CSV downloaded.");
};

actions["export-xlsx"] = async (el) => {
  el.disabled = true; el.textContent = "Preparing…";
  try {
    await loadSheetJs();
    const rows = loanRowsForExport();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Loans");
    XLSX.writeFile(wb, `ledger-loans-${toISODate(Date.now())}.xlsx`);
    toast("Excel file downloaded.");
  } catch (e) {
    toast("Couldn't load the export library — check your connection.");
  } finally {
    el.disabled = false; el.textContent = "Export Excel";
  }
};

actions["export-pdf"] = async (el) => {
  el.disabled = true; el.textContent = "Preparing…";
  try {
    await loadJsPdf();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    let y = 18;
    pdf.setFontSize(16); pdf.text("Ledger — full report", 14, y); y += 6;
    pdf.setFontSize(10); pdf.text(new Date().toLocaleDateString(), 14, y); y += 10;

    const { owedToYou, youOwe } = totalsByDirection();
    pdf.setFontSize(12); pdf.text("Summary", 14, y); y += 6;
    pdf.setFontSize(10);
    for (const c of Array.from(new Set([...Object.keys(owedToYou), ...Object.keys(youOwe)]))) {
      pdf.text(`${c}  Owed to you: ${fmtMoney(owedToYou[c] || 0, c)}   You owe: ${fmtMoney(youOwe[c] || 0, c)}`, 14, y);
      y += 6;
    }
    y += 4;
    pdf.setFontSize(12); pdf.text("People", 14, y); y += 6;
    pdf.setFontSize(10);
    for (const p of activePeople()) {
      const net = personNet(p.id);
      const parts = Object.entries(net).filter(([, v]) => Math.abs(v) > 0.005).map(([c, v]) => `${v > 0 ? "+" : ""}${fmtMoney(v, c)}`);
      if (y > 280) { pdf.addPage(); y = 18; }
      pdf.text(`${p.name}: ${parts.join(", ") || "settled"}`, 14, y);
      y += 6;
    }
    pdf.save(`ledger-report-${toISODate(Date.now())}.pdf`);
    toast("PDF downloaded.");
  } catch (e) {
    toast("Couldn't load the export library — check your connection.");
  } finally {
    el.disabled = false; el.textContent = "Export full report (PDF)";
  }
};

async function exportPersonStatementPdf(pid) {
  const p = S.people.find((x) => x.id === pid);
  if (!p) return;
  try {
    await loadJsPdf();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    let y = 18;
    pdf.setFontSize(16); pdf.text(`Statement — ${p.name}`, 14, y); y += 6;
    pdf.setFontSize(10); pdf.text(new Date().toLocaleDateString(), 14, y); y += 10;

    for (const t of personTxns(pid).sort((a, b) => a.createdAt - b.createdAt)) {
      if (y > 270) { pdf.addPage(); y = 18; }
      pdf.setFontSize(11);
      pdf.text(`${fmtDate(t.createdAt)} — ${t.type === "lent" ? "Lent" : "Borrowed"} ${fmtMoney(t.principal, t.currency)}${t.description ? " — " + t.description : ""}`, 14, y);
      y += 5;
      pdf.setFontSize(9);
      pdf.text(`Status: ${t.status} · Paid ${fmtMoney(txnPaid(t), t.currency)} · Remaining ${fmtMoney(txnRemaining(t), t.currency)}`, 18, y);
      y += 7;
    }
    pdf.save(`statement-${p.name.replace(/\s+/g, "-").toLowerCase()}-${toISODate(Date.now())}.pdf`);
    toast("Statement downloaded.");
  } catch (e) {
    toast("Couldn't load the export library — check your connection.");
  }
}

// ============================================================================
// SETTINGS: appearance, security, defaults, data, sign out
// ============================================================================

async function saveSettings(patch) {
  await setDoc(doc(db, "users", S.user.uid, "settings", "app"), { ...S.settings, ...patch }, { merge: true });
}

function viewSettings() {
  const content = `
    <div class="section-title">Account</div>
    <div class="card"><p style="margin:0">${escapeHtml(S.user.email)}</p></div>

    <div class="section-title">Appearance</div>
    <div class="card">
      <div class="row" style="border:none">
        <div class="main title">Theme</div>
        <div class="btn-row" style="flex:none;width:auto">
          <button type="button" class="btn ${S.settings.theme === "dark" ? "primary" : "ghost"}" style="width:auto" data-action="set-theme" data-theme="dark">Dark</button>
          <button type="button" class="btn ${S.settings.theme === "light" ? "primary" : "ghost"}" style="width:auto" data-action="set-theme" data-theme="light">Light</button>
        </div>
      </div>
    </div>

    <div class="section-title">Security</div>
    <div class="card">
      <div class="row" style="border:none">
        <div class="main">
          <div class="title">App lock (PIN)</div>
          <div class="sub">${S.settings.pinHash ? "Enabled" : "Off — sign-in only"}</div>
        </div>
        <button type="button" class="btn ${S.settings.pinHash ? "danger" : "primary"}" style="width:auto" data-action="${S.settings.pinHash ? "turn-off-pin" : "set-pin"}">${S.settings.pinHash ? "Turn off" : "Set PIN"}</button>
      </div>
    </div>

    <div class="section-title">Defaults</div>
    <div class="card">
      <div class="field" style="margin-bottom:0.75rem">
        <label>Default currency</label>
        <select data-action="set-default-currency">${CURRENCY_CODES.map((c) => `<option value="${c}" ${S.settings.defaultCurrency === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Trash retention</label>
        <select data-action="set-retention">${RETENTION_OPTIONS.map((d) => `<option value="${d}" ${S.settings.purgeDays === d ? "selected" : ""}>${d} days</option>`).join("")}</select>
      </div>
    </div>

    <div class="section-title">Data</div>
    <div class="card" style="padding:0.3rem 1rem">
      <a class="row" href="#/trash"><div class="main title">Trash</div><div class="amount">${trashCount()}</div></a>
      <button type="button" class="row" style="width:100%;background:none;border:none;text-align:left" data-action="backup-data"><div class="main title">Back up all data</div></button>
      <button type="button" class="row" style="width:100%;background:none;border:none;text-align:left" data-action="restore-data"><div class="main title">Restore from backup</div></button>
    </div>

    <button type="button" class="btn danger" style="margin-top:0.5rem" data-action="sign-out">Sign out</button>
    <input type="file" id="restore-file-input" accept="application/json" style="display:none">
  `;
  return renderShell({ title: "Settings", tab: "settings", content });
}

actions["set-theme"] = (el) => saveSettings({ theme: el.dataset.theme });
actions["set-default-currency"] = (el) => saveSettings({ defaultCurrency: el.value });
actions["set-retention"] = (el) => saveSettings({ purgeDays: parseInt(el.value, 10) });
actions["sign-out"] = () => { if (confirm("Sign out?")) signOut(auth); };

actions["set-pin"] = () => {
  openSheet(`
    <h2>Set a PIN</h2>
    <p class="muted" style="font-size:0.85rem">Choose a 4-digit PIN. You'll enter it once more to confirm.</p>
    <div class="pin-dots" id="setpin-dots" style="margin:1rem 0">${[0, 1, 2, 3].map(() => `<span></span>`).join("")}</div>
    ${pinpadHtml()}
  `, {
    onMount: () => {
      let stage = "enter"; let first = "", entered = "";
      function renderDots() {
        $$("#setpin-dots span").forEach((s, i) => s.classList.toggle("filled", i < entered.length));
      }
      actions["pin-key"] = async (el) => {
        const key = el.dataset.key;
        if (key === "back") entered = entered.slice(0, -1);
        else if (entered.length < 4) entered += key;
        renderDots();
        if (entered.length === 4) {
          if (stage === "enter") {
            first = entered; entered = ""; stage = "confirm";
            $("#sheet-root h2").textContent = "Confirm your PIN";
            renderDots();
          } else {
            if (entered === first) {
              const hash = await sha256Hex(entered);
              await saveSettings({ pinHash: hash });
              S.unlockedThisSession = true;
              closeSheet();
              toast("PIN set.");
              restorePinKeyAction();
            } else {
              toast("PINs didn't match — try again.");
              stage = "enter"; first = ""; entered = "";
              $("#sheet-root h2").textContent = "Set a PIN";
              renderDots();
            }
          }
        }
      };
    },
  });
};
actions["turn-off-pin"] = async () => {
  if (!confirm("Turn off the app PIN lock?")) return;
  await saveSettings({ pinHash: null });
  toast("PIN lock turned off.");
};
function restorePinKeyAction() {
  actions["pin-key"] = async (el) => {
    const key = el.dataset.key;
    if (key === "back") viewPinLock.entered = viewPinLock.entered.slice(0, -1);
    else if (viewPinLock.entered.length < 4) viewPinLock.entered += key;
    if (viewPinLock.entered.length === 4) {
      const hash = await sha256Hex(viewPinLock.entered);
      if (hash === S.settings.pinHash) { S.unlockedThisSession = true; viewPinLock.entered = ""; viewPinLock.error = ""; renderCurrent(); return; }
      viewPinLock.error = "Incorrect PIN."; viewPinLock.entered = "";
    }
    renderCurrent();
  };
}

// ---- Backup & restore ----
actions["backup-data"] = async () => {
  const settingsSnap = { theme: S.settings.theme, defaultCurrency: S.settings.defaultCurrency, purgeDays: S.settings.purgeDays };
  const people = S.people.map((p) => ({ ...p, txns: S.txns.filter((t) => t.personId === p.id) }));
  const accounts = S.accounts.map((a) => ({ ...a, entries: S.entries.filter((e) => e.accountId === a.id) }));
  const investments = S.investments.map((i) => ({ ...i, balances: S.balances.filter((b) => b.investmentId === i.id) }));
  const backup = { version: 4, exportedAt: Date.now(), settings: settingsSnap, people, accounts, investments };
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `ledger-backup-${toISODate(Date.now())}.json`);
  toast("Backup downloaded.");
};

actions["restore-data"] = () => {
  const input = $("#restore-file-input");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const peopleCount = (data.people || []).length;
      const accountsCount = (data.accounts || []).length;
      const investmentsCount = (data.investments || []).length;
      if (!confirm(`Import ${peopleCount} people, ${accountsCount} accounts, and ${investmentsCount} investment platforms? This adds to your current data — nothing existing is overwritten.`)) return;
      await restoreBackup(data);
      toast("Backup restored.");
    } catch (e) {
      toast("That file couldn't be read as a backup.");
    }
  };
  input.click();
};

async function restoreBackup(data) {
  const uid = S.user.uid;
  for (const p of data.people || []) {
    const { txns, id, ...personData } = p;
    const ref = await addDoc(collection(db, "users", uid, "people"), personData);
    for (const t of txns || []) {
      const { id: tid, personId, ...txnData } = t;
      await addDoc(collection(db, "users", uid, "people", ref.id, "txns"), { ...txnData, uid });
    }
  }
  for (const a of data.accounts || []) {
    const { entries, id, ...accountData } = a;
    const ref = await addDoc(collection(db, "users", uid, "accounts"), accountData);
    for (const e of entries || []) {
      const { id: eid, accountId, ...entryData } = e;
      await addDoc(collection(db, "users", uid, "accounts", ref.id, "entries"), { ...entryData, uid });
    }
  }
  for (const inv of data.investments || []) {
    const { balances, id, ...invData } = inv;
    const ref = await addDoc(collection(db, "users", uid, "investments"), invData);
    for (const b of balances || []) {
      const { id: bid, investmentId, ...balanceData } = b;
      await addDoc(collection(db, "users", uid, "investments", ref.id, "balances"), { ...balanceData, uid });
    }
  }
  // Older backup files (version 3 and earlier) may still contain a `notes`
  // array from the removed Notes feature — deliberately ignored, not
  // restored. See FINAL_SPEC.md §9.
}

// ============================================================================
// BOOT
// ============================================================================

// TEMPORARILY DISABLED during active development — service worker caching
// makes live-testing edits unreliable. RESTORE before final release.
// if ("serviceWorker" in navigator) {
//   window.addEventListener("load", () => {
//     navigator.serviceWorker.register("./sw.js").catch((err) => console.error("sw register failed", err));
//   });
// }

onAuthStateChanged(auth, (user) => {
  S.authReady = true;
  if (user) {
    S.user = user;
    attachListeners();
  } else {
    detachListeners();
    S.user = null;
  }
  renderCurrent();
});
