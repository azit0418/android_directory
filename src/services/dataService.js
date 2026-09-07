/**
 * dataService.js
 * -----------------------------------------------------------------------
 * Every network call to the Google Apps Script backend lives here — the
 * component should never call fetch() directly.
 *
 * CACHING FIX: browsers (and some intermediate proxies) can cache GET
 * requests, including ones to script.google.com, since Apps Script
 * doesn't send cache-preventing headers. That's the most likely reason a
 * second browser/device showed stale data — it was reading a cached
 * response instead of hitting the Sheet. Every request here now sets
 * `cache: "no-store"` and GETs add a cache-busting timestamp param, so
 * every read is guaranteed to actually reach the server.
 *
 * BILLING: implemented as small, single-purpose remote calls (one per
 * kind of change — add a payment, approve a request, etc.) rather than
 * "fetch the whole thing, edit it, save the whole thing back." The
 * server applies each change atomically under a lock (see
 * AppsScript_Code.gs) and returns the fresh, authoritative billing
 * object every time — the client should always replace its local billing
 * state with whatever the server just returned, never assume its own
 * optimistic copy is correct.
 * ------------------------------------------------------------------------- */

export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzOFTbN9og1PH0h4Vict43wpFlliqWtxIrKL15K6yAwkX9joJVXEnrTcNlpOJMthapsng/exec";

export function isConfigured() {
  return !!APPS_SCRIPT_URL;
}

async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, _: Date.now().toString(), ...params }).toString();
  const res = await fetch(`${APPS_SCRIPT_URL}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Request failed: " + res.status);
  return res.json();
}

async function apiPost(body) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // avoids a CORS preflight against Apps Script
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Request failed: " + res.status);
  return res.json();
}

/* ---------------- Students ---------------- */
export const fetchStudents = () => apiGet("students");
export const addStudentRemote = (student) => apiPost({ action: "addStudent", student });
export const updateStudentRemote = (row, student) => apiPost({ action: "updateStudent", row, student });
export const deleteStudentRemote = (row) => apiPost({ action: "deleteStudent", row });

/* ---------------- Attendance ---------------- */
export const fetchAttendance = () => apiGet("attendance");
export const saveAttendanceDayRemote = (day, entries) => apiPost({ action: "saveAttendanceDay", day, entries });

/* ---------------- Billing: one call per kind of change, each atomic on the server ---------------- */
export const fetchBilling = () => apiGet("billing");
export const setDefaultFeeRemote = (value) => apiPost({ action: "billing_setDefaultFee", value });

export const addBillRemote = (row, title, amount) => apiPost({ action: "billing_addBill", row, title, amount });
export const updateBillRemote = (row, billId, title, amount) => apiPost({ action: "billing_updateBill", row, billId, title, amount });
export const deleteBillRemote = (row, billId) => apiPost({ action: "billing_deleteBill", row, billId });

export const addPaymentRemote = (row, amount, note, date) => apiPost({ action: "billing_addPayment", row, amount, note, date });
export const updatePaymentRemote = (row, paymentId, amount, note, date) => apiPost({ action: "billing_updatePayment", row, paymentId, amount, note, date });
export const deletePaymentRemote = (row, paymentId) => apiPost({ action: "billing_deletePayment", row, paymentId });

export const addExpenseRemote = (category, payee, amount, date, note) => apiPost({ action: "billing_addExpense", category, payee, amount, date, note });
export const updateExpenseRemote = (id, category, payee, amount, date, note) => apiPost({ action: "billing_updateExpense", id, category, payee, amount, date, note });
export const deleteExpenseRemote = (id) => apiPost({ action: "billing_deleteExpense", id });

export const addPaymentRequestRemote = (row, amount, note, date, actor) => apiPost({ action: "billing_addPaymentRequest", row, amount, note, date, actor });
export const decidePaymentRequestRemote = (id, status, decidedBy) => apiPost({ action: "billing_decidePaymentRequest", id, status, decidedBy });

export const generateBillsRemote = (title, amountMode, fixedAmount, targetRows, defaultFee) =>
  apiPost({ action: "billing_generateBills", title, amountMode, fixedAmount, targetRows, defaultFee });

/* ---------------- Users (one row per account — used by authService) ---------------- */
export const fetchUsersRemote = () => apiGet("users");
export const addUserRemote = (username, passwordHash) => apiPost({ action: "addUser", username, passwordHash });
export const checkLoginRemote = (username, passwordHash) => apiPost({ action: "checkLogin", username, passwordHash });
export const deleteUserRemote = (username) => apiPost({ action: "deleteUser", username });
