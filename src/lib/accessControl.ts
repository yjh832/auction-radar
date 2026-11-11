const ACCESS_KEY = "auction-radar:owner-access:v1";
const LAST_SEEN_KEY = "auction-radar:last-seen-time:v1";
const OWNER_HASH =
  "50edc05b86413d496650f626ad80160ea5d9c97fd4679409d5d1d2906dbe8b43";
const OWNER_HASH_PREFIX = "auction-radar-owner-v1:";
const OWNER_ACCESS_YEARS = 5;

export const PUBLIC_ACCESS_ENDS_AT = Date.parse(
  "2026-12-12T23:59:59+08:00"
);

interface StoredOwnerAccess {
  deviceId: string;
  expiresAt: number;
  signature: string;
}

function normalizeOwnerCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readStoredAccess(): StoredOwnerAccess | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(ACCESS_KEY) ?? "null"
    ) as Partial<StoredOwnerAccess> | null;
    if (
      !parsed ||
      typeof parsed.deviceId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.signature !== "string"
    ) {
      return null;
    }
    return parsed as StoredOwnerAccess;
  } catch {
    return null;
  }
}

function deviceId() {
  const key = `${ACCESS_KEY}:device`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, created);
  return created;
}

async function signature(deviceIdValue: string, expiresAt: number) {
  return sha256(
    `${OWNER_HASH}:${deviceIdValue}:${expiresAt}:auction-radar-local-access`
  );
}

export async function hasStoredOwnerAccess() {
  const stored = readStoredAccess();
  if (!stored || stored.expiresAt <= Date.now()) return false;
  return (
    stored.signature ===
    (await signature(stored.deviceId, stored.expiresAt))
  );
}

export async function verifyOwnerCode(value: string) {
  const normalized = normalizeOwnerCode(value);
  if (normalized.length < 16) return false;
  return (
    (await sha256(`${OWNER_HASH_PREFIX}${normalized}`)) === OWNER_HASH
  );
}

export async function unlockOwnerAccess() {
  const id = deviceId();
  const expiresAt =
    Date.now() + OWNER_ACCESS_YEARS * 365 * 24 * 60 * 60 * 1_000;
  const stored: StoredOwnerAccess = {
    deviceId: id,
    expiresAt,
    signature: await signature(id, expiresAt)
  };
  localStorage.setItem(ACCESS_KEY, JSON.stringify(stored));
}

export async function resolveCurrentAccessTime() {
  const localNow = Date.now();
  let lastSeen = 0;
  try {
    lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) ?? 0);
  } catch {
    // The local clock remains usable if storage is unavailable.
  }
  let serverNow = 0;
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}version.json?accessTime=${localNow}`,
      { cache: "no-store" }
    );
    const date = response.headers.get("date");
    const parsed = date ? Date.parse(date) : 0;
    if (Number.isFinite(parsed) && parsed > 0) serverNow = parsed;
  } catch {
    // Offline access uses the latest trusted time saved on this device.
  }
  const trustedNow = Math.max(localNow, serverNow, lastSeen);
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(trustedNow));
  } catch {
    // Time persistence is best-effort.
  }
  return trustedNow;
}
