// ─── Base64 helpers ─────────────────────────────────────────
// Files cross extension contexts as base64 strings (runtime messages are
// JSON-serialized), so these helpers are shared by content scripts, the
// service worker and the side panel.

const CHUNK_SIZE = 8192;

/** Encode bytes as base64 without overflowing the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Decode base64 into bytes (backed by a plain ArrayBuffer, so Blob-safe). */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** UTF-8 encode text, then base64 encode it. */
export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/**
 * Decode base64 as strict UTF-8 text.
 * Returns null when the bytes are not valid UTF-8 (i.e. a binary file).
 */
export function base64ToText(base64: string): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      base64ToBytes(base64),
    );
  } catch {
    return null;
  }
}
