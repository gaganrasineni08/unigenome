// Private keys are encrypted with the user's passphrase before they leave the browser:
// PBKDF2-SHA256 (200,000 rounds) turns the passphrase into an AES-256-GCM key.
import { fromB64url, fromHex, randomBytes, toB64url, toHex, utf8 } from "./bytes";

export interface EncryptedKey {
  v: 1;
  salt: string; // b64url
  iv: string; // b64url
  ct: string; // b64url ciphertext of the 32-byte secret key
  iter: number;
}

const subtle = () => globalThis.crypto.subtle;

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number) {
  const base = await subtle().importKey("raw", utf8(passphrase) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecretKey(secretKeyHex: string, passphrase: string): Promise<EncryptedKey> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iter = 200_000;
  const key = await deriveKey(passphrase, salt, iter);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, fromHex(secretKeyHex) as BufferSource));
  return { v: 1, salt: toB64url(salt), iv: toB64url(iv), ct: toB64url(ct), iter };
}

/** Throws if the passphrase is wrong: AES-GCM refuses to decrypt with the wrong key. */
export async function decryptSecretKey(e: EncryptedKey, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromB64url(e.salt), e.iter);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64url(e.iv) as BufferSource }, key, fromB64url(e.ct) as BufferSource);
  return toHex(new Uint8Array(pt));
}
