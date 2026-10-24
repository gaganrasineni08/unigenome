// SHA-256 hashing and Ed25519 signatures (DSA topics 1 and 2).
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonical, fromB64url, fromHex, toB64url, toHex, utf8 } from "./bytes";

export const sha256Hex = (data: string | Uint8Array): string =>
  toHex(sha256(typeof data === "string" ? utf8(data) : data));

export interface KeyPair {
  secretKey: string; // hex, 32 bytes
  publicKey: string; // hex, 32 bytes
}

export function generateKeyPair(): KeyPair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secretKey: toHex(secretKey), publicKey: toHex(publicKey) };
}

export const publicKeyOf = (secretKeyHex: string): string =>
  toHex(ed25519.getPublicKey(fromHex(secretKeyHex)));

/**
 * Every signed message starts with a domain tag ("UG/item", "UG/event", ...) so a
 * signature made for one purpose can never be replayed as another.
 */
export function signMessage(domain: string, body: unknown, secretKeyHex: string): string {
  const msg = utf8(domain + "\n" + canonical(body));
  return toB64url(ed25519.sign(msg, fromHex(secretKeyHex)));
}

export function verifyMessage(domain: string, body: unknown, sigB64: string, publicKeyHex: string): boolean {
  try {
    const msg = utf8(domain + "\n" + canonical(body));
    return ed25519.verify(fromB64url(sigB64), msg, fromHex(publicKeyHex));
  } catch {
    return false;
  }
}

export const hashOf = (domain: string, body: unknown): string => sha256Hex(domain + "\n" + canonical(body));
