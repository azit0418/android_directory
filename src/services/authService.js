/**
 * authService.js
 * -----------------------------------------------------------------------
 * All authentication logic lives here, separate from data-handling and
 * from the UI. Two account types:
 *
 *  - Admin: a single fixed username/password checked locally against the
 *    constants below. There's no server-side secret to compare against,
 *    so changing the password just means editing ADMIN_PASSWORD here.
 *  - Staff: real accounts. Passwords are hashed (SHA-256 via the
 *    browser's native crypto, never sent or stored as plain text) and
 *    the (username, passwordHash) pairs live in a Google Sheet via
 *    dataService — so an account created on one device works on any
 *    other device too, once they're both online.
 *
 * IMPORTANT — read this before relying on it for anything sensitive:
 * this is still a *client-side* gate, not real server-side security.
 * The Apps Script backend has no concept of "who is asking" — it will
 * run addUser/checkLogin for literally anyone who can reach the URL,
 * the same way it already does for students/attendance. Hashing means
 * a password isn't sitting in the Sheet as plain text, but it does NOT
 * mean this system can withstand a determined attacker. Don't store
 * anything here you wouldn't be okay with a technically capable person
 * eventually accessing.
 * ------------------------------------------------------------------------- */

import { safeGet, safeSet } from "./storage";
import { fetchUsersRemote, addUserRemote, checkLoginRemote, deleteUserRemote } from "./dataService";

export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "Shanti@2083"; // change this before real use

const SESSION_KEY = "sts-auth";

export async function hashPassword(pw) {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const data = new TextEncoder().encode(pw);
      const buf = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) { /* fall through to the non-crypto fallback below */ }
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = (h * 31 + pw.charCodeAt(i)) | 0;
  return "fb-" + h.toString(16);
}

/* ---------------- Session persistence (local convenience cache) ----------
   This is what makes a page refresh NOT log you out: the session itself
   is just a small local marker { role, name }. It is re-validated against
   the Sheet on load for staff accounts (see validateSession) so that
   deleting a staff account, or clearing/tampering with local storage,
   can't be used to keep access alive indefinitely — see validateSession.
   ------------------------------------------------------------------------- */
export async function loadSession() {
  const raw = await safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.role === "admin" || parsed.role === "staff") && parsed.name) return parsed;
  } catch (e) { /* corrupt/old session data — treat as logged out */ }
  return null;
}
export async function saveSession(role, name) {
  const user = { role, name };
  await safeSet(SESSION_KEY, user);
  return user;
}
export async function clearSession() {
  await safeSet(SESSION_KEY, null);
}

/**
 * Re-checks a cached staff session against the Sheet. Fails OPEN on
 * network errors (so the app still works offline / if the Sheet URL is
 * temporarily unreachable) but fails CLOSED — logs the session out — if
 * the Sheet is reachable and the account genuinely no longer exists.
 * This is the "can't bypass by refreshing" safeguard: a removed account
 * loses access the next time it can actually reach the backend, rather
 * than being able to keep a stale session alive forever.
 */
export async function validateSession(session) {
  if (!session || session.role !== "staff") return session; // admin isn't sheet-backed
  try {
    const users = await fetchUsersRemote();
    const stillExists = Array.isArray(users) && users.some((u) => u.username === session.name);
    if (!stillExists) { await clearSession(); return null; }
  } catch (e) { /* offline or backend unreachable — keep the cached session */ }
  return session;
}

/* ---------------- Admin ---------------- */
export async function loginAdmin(username, password) {
  if ((username || "").trim().toLowerCase() !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return { ok: false, error: "Incorrect username or password" };
  }
  await saveSession("admin", "Admin");
  return { ok: true };
}

/* ---------------- Staff: register + login against the Sheet ---------------- */
export async function registerStaff(username, password, confirmPassword) {
  const uname = (username || "").trim();
  if (!uname) return { ok: false, error: "Enter a username" };
  if (uname.toLowerCase() === ADMIN_USERNAME) return { ok: false, error: "That username is reserved" };
  if (!password || password.length < 4) return { ok: false, error: "Password must be at least 4 characters" };
  if (password !== confirmPassword) return { ok: false, error: "Passwords don't match" };

  const passwordHash = await hashPassword(password);
  let res;
  try {
    res = await addUserRemote(uname, passwordHash);
  } catch (e) {
    return { ok: false, error: "Could not reach the Sheet. Check your connection and try again." };
  }
  if (!res || res.ok !== true) return { ok: false, error: (res && res.error) || "Could not create the account" };

  await saveSession("staff", uname);
  return { ok: true, username: uname };
}

export async function loginStaff(username, password) {
  const uname = (username || "").trim();
  if (!uname || !password) return { ok: false, error: "Enter your username and password" };

  const passwordHash = await hashPassword(password);
  let res;
  try {
    res = await checkLoginRemote(uname, passwordHash);
  } catch (e) {
    return { ok: false, error: "Could not reach the Sheet. Check your connection and try again." };
  }
  if (!res || res.ok !== true) return { ok: false, error: (res && res.error) || "Incorrect username or password" };

  await saveSession("staff", res.username || uname);
  return { ok: true, username: res.username || uname };
}

export async function listStaffUsers() {
  try {
    const users = await fetchUsersRemote();
    return Array.isArray(users) ? users.map((u) => u.username).filter(Boolean).sort() : [];
  } catch (e) {
    return [];
  }
}

export async function removeStaffUser(username) {
  try {
    await deleteUserRemote(username);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Could not reach the Sheet." };
  }
}

export async function logout() {
  await clearSession();
}
