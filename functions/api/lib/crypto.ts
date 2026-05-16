/**
 * HMAC-SHA256 verification helper using the Web Crypto API.
 * Compatible with Cloudflare Workers (V8 isolate — no Node.js built-ins).
 */

/**
 * Verify an HMAC-SHA256 signature.
 *
 * @param secret    The shared secret key (string)
 * @param body      The raw request body (string or ArrayBuffer)
 * @param signature The hex-encoded signature from the provider
 */
export async function verifyHmacSignature(
  secret: string,
  body: string | ArrayBuffer,
  signature: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const keyData = enc.encode(secret);
    const messageData = typeof body === "string" ? enc.encode(body) : body;

    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Signature is hex-encoded — convert to Uint8Array
    const sigBytes = hexToBytes(signature);

    return await crypto.subtle.verify("HMAC", key, sigBytes, messageData);
  } catch {
    return false;
  }
}

/**
 * Compute an HMAC-SHA256 signature (for testing / signature generation).
 */
export async function computeHmacSignature(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return bytesToHex(new Uint8Array(sig));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
