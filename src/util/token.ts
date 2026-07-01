import * as crypto from "node:crypto";

/**
 * Constant-time comparison of two secret strings. Returns false (without leaking
 * timing) when the lengths differ. Used to validate the per-session IPC tokens
 * that authenticate the askpass / editor shims back to the extension.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** A fresh, unguessable per-session token. */
export function makeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** A cryptographically random 128-bit nonce for a single webview document. */
export function makeNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}
