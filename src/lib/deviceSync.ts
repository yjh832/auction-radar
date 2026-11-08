import type { HoldingPosition } from "../types";

const PAYLOAD_VERSION = 1;
const HASH_PREFIX = "holdings-sync=";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array) {
  if (!crypto.subtle) throw new Error("当前环境不支持设备加密同步");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 120_000,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptHoldings(
  holdings: HoldingPosition[],
  password: string
) {
  if (password.trim().length < 6) throw new Error("同步口令至少6位");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      version: PAYLOAD_VERSION,
      exportedAt: new Date().toISOString(),
      holdings
    })
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  return [
    "v1",
    bytesToBase64Url(salt),
    bytesToBase64Url(iv),
    bytesToBase64Url(new Uint8Array(encrypted))
  ].join(".");
}

export async function decryptHoldings(token: string, password: string) {
  const [version, saltText, ivText, cipherText] = token.trim().split(".");
  if (version !== "v1" || !saltText || !ivText || !cipherText) {
    throw new Error("同步码格式不正确");
  }
  const key = await deriveKey(password, base64UrlToBytes(saltText));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivText) },
    key,
    base64UrlToBytes(cipherText)
  );
  const payload = JSON.parse(new TextDecoder().decode(decrypted)) as {
    version?: number;
    holdings?: unknown;
  };
  if (payload.version !== PAYLOAD_VERSION || !Array.isArray(payload.holdings)) {
    throw new Error("同步内容格式不正确");
  }
  return payload.holdings.filter((item): item is HoldingPosition => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.code === "string" &&
      typeof row.cost === "number" &&
      typeof row.shares === "number"
    );
  });
}

export function buildHoldingsSyncUrl(token: string) {
  const url = new URL(window.location.href);
  url.hash = `${HASH_PREFIX}${token}`;
  return url.toString();
}

export function extractHoldingsSyncToken(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const hash = url.hash.replace(/^#/, "");
    if (hash.startsWith(HASH_PREFIX)) {
      return decodeURIComponent(hash.slice(HASH_PREFIX.length));
    }
  } catch {
    // A raw token or pasted hash is handled below.
  }
  const hashIndex = trimmed.indexOf(HASH_PREFIX);
  return hashIndex >= 0
    ? decodeURIComponent(trimmed.slice(hashIndex + HASH_PREFIX.length))
    : trimmed;
}

export function tokenFromCurrentLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith(HASH_PREFIX)
    ? decodeURIComponent(hash.slice(HASH_PREFIX.length))
    : null;
}

export function clearSyncHash() {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}
