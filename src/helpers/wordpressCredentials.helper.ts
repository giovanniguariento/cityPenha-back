import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function resolveEncryptionKey(): Buffer {
  const raw = process.env.WORDPRESS_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error('WORDPRESS_CREDENTIALS_ENCRYPTION_KEY is not configured');
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const asBase64 = Buffer.from(raw, 'base64');
  if (asBase64.length === 32) {
    return asBase64;
  }

  throw new Error('WORDPRESS_CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (hex or base64)');
}

export function generateWordpressPassword(): string {
  return randomBytes(16).toString('base64url');
}

export function encryptWordpressPassword(plain: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptWordpressPassword(enc: string): string {
  const parts = enc.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted WordPress password format');
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;
  const key = resolveEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function tryDecryptWordpressPassword(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    return decryptWordpressPassword(enc);
  } catch {
    return null;
  }
}
