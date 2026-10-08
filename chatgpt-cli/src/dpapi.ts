import { Dpapi, isPlatformSupported } from '@primno/dpapi';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CredentialEncryption } from '@siwc/local';

// Entropy binds this ciphertext format to this app. It is not an encryption key.
const entropy = Buffer.from('social-summarizer-chatgpt-feasibility:dpapi:v1', 'utf8');
const magic = Buffer.from('SSP1');

function encrypt(plaintext: string): Uint8Array {
  const key = randomBytes(32);
  const bytes = Buffer.from(plaintext, 'utf8');
  try {
    const protectedKey = Buffer.from(Dpapi.protectData(key, entropy, 'CurrentUser'));
    const header = Buffer.alloc(8);
    magic.copy(header);
    header.writeUInt32BE(protectedKey.length, 4);
    const nonce = randomBytes(12);
    const authenticatedHeader = Buffer.concat([header, protectedKey, nonce]);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    // Authenticate even DPAPI metadata bytes that Windows might otherwise ignore.
    cipher.setAAD(authenticatedHeader);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([authenticatedHeader, cipher.getAuthTag(), encrypted]);
  } finally { key.fill(0); bytes.fill(0); }
}

function decrypt(ciphertext: Uint8Array): string {
  const blob = Buffer.from(ciphertext);
  if (blob.length < 37 || !blob.subarray(0, 4).equals(magic)) throw new Error('Invalid protected envelope');
  const keyLength = blob.readUInt32BE(4);
  if (keyLength < 1 || keyLength > 64 * 1024 || 8 + keyLength + 28 >= blob.length) {
    throw new Error('Invalid protected envelope');
  }
  const nonceOffset = 8 + keyLength;
  const tagOffset = nonceOffset + 12;
  const key = Buffer.from(Dpapi.unprotectData(blob.subarray(8, nonceOffset), entropy, 'CurrentUser'));
  let decoded: Buffer | undefined;
  let first: Buffer | undefined;
  try {
    if (key.length !== 32) throw new Error('Invalid protected key');
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(nonceOffset, tagOffset));
    decipher.setAAD(blob.subarray(0, tagOffset));
    decipher.setAuthTag(blob.subarray(tagOffset, tagOffset + 16));
    first = decipher.update(blob.subarray(tagOffset + 16));
    decoded = Buffer.concat([first, decipher.final()]);
    return decoded.toString('utf8');
  } finally { key.fill(0); first?.fill(0); decoded?.fill(0); }
}

export function createDpapiEncryption(): CredentialEncryption {
  return {
    id: 'windows-dpapi-current-user-aesgcm-v1',
    isAvailable() {
      if (process.platform !== 'win32' || !isPlatformSupported) return false;
      try {
        return decrypt(encrypt('DPAPI availability probe')) === 'DPAPI availability probe';
      } catch { return false; }
    },
    encrypt,
    decrypt,
  };
}
