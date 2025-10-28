// api/src/crypto.ts
import { webcrypto } from "node:crypto";

export function hexToBytes(h: string): Uint8Array {
  const hex = h.toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

// Convert a decimal ms string to 8-byte big-endian
export function u64StringTo8BE(msStr: string): Uint8Array {
  const n = BigInt(msStr);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) out[i] = Number((n >> BigInt((7 - i) * 8)) & 0xffn);
  return out;
}

// Canonical message: nonce16 || ts_be64
export function buildMessage(nonceHex: string, tsMs: string): Uint8Array {
  const nonce = hexToBytes(nonceHex);
  if (nonce.length !== 16) {
    throw new Error("nonce must be exactly 16 bytes");
  }
  const ts = u64StringTo8BE(tsMs);
  const msg = new Uint8Array(24); // 16 + 8
  msg.set(nonce, 0);
  msg.set(ts, 16);
  return msg;
}

// 16-byte CSPRNG nonce
export function randomNonce16(): Uint8Array {
  const arr = new Uint8Array(16);
  webcrypto.getRandomValues(arr);
  return arr;
}
