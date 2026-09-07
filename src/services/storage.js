/**
 * Storage shim: window.storage only exists inside Claude's artifact
 * preview. Outside of it (your real Vite/Capacitor app) this falls back to
 * localStorage, so anything using it persists on-device. Shared by
 * authService (session + password-free local caches) and the main
 * component (Teachers, which are still local-only, not sheet-synced).
 */
export const storage = (typeof window !== "undefined" && window.storage) ? window.storage : {
  async get(key) {
    try {
      if (typeof localStorage === "undefined") return null;
      const v = localStorage.getItem(key);
      return v !== null ? { key, value: v } : null;
    } catch (e) { return null; }
  },
  async set(key, value) {
    try {
      if (typeof localStorage === "undefined") return null;
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) { return null; }
  },
  async delete(key) {
    try {
      if (typeof localStorage === "undefined") return null;
      localStorage.removeItem(key);
      return { key, deleted: true };
    } catch (e) { return null; }
  },
};

export async function safeGet(key) {
  try {
    const r = await storage.get(key, false);
    return r && r.value ? r.value : null;
  } catch (e) { return null; }
}

export async function safeSet(key, value) {
  try {
    const res = await storage.set(key, JSON.stringify(value), false);
    return !!res;
  } catch (e) { return false; }
}
