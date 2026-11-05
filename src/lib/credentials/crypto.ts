import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class VaultKeyError extends Error {
  constructor() {
    super("boveda_sin_clave");
    this.name = "VaultKeyError";
  }
}

export type VaultEnv = {
  CREDENTIALS_MASTER_KEY?: string;
  [key: string]: string | undefined;
};

export type CipherBundle = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function readMasterKey(env: VaultEnv = process.env) {
  const raw = env.CREDENTIALS_MASTER_KEY;
  if (typeof raw !== "string" || !raw.trim()) throw new VaultKeyError();
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new VaultKeyError();
  }
  if (key.length !== 32) throw new VaultKeyError();
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): CipherBundle {
  if (key.length !== 32) throw new VaultKeyError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(bundle: CipherBundle, key: Buffer) {
  if (key.length !== 32) throw new VaultKeyError();
  const iv = Buffer.from(bundle.iv, "base64");
  const authTag = Buffer.from(bundle.authTag, "base64");
  const data = Buffer.from(bundle.ciphertext, "base64");
  if (iv.length !== 12 || authTag.length !== 16 || data.length < 1) {
    throw new Error("cifrado_invalido");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof VaultKeyError) throw error;
    throw new Error("cifrado_invalido");
  }
}
