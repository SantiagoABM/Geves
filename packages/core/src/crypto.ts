import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Alfabeto Crockford base32: sin I, L, O ni U para evitar confusiones al teclear. */
export const LICENSE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const LICENSE_LENGTH = 25;
const GROUP = 5;

/** Clave de usuario: 25 caracteres aleatorios (125 bits) en 5 grupos de 5. */
export function generateLicenseKey(): string {
  let raw = "";
  for (let i = 0; i < LICENSE_LENGTH; i++) raw += LICENSE_ALPHABET[randomInt(LICENSE_ALPHABET.length)];
  return raw.match(new RegExp(`.{${GROUP}}`, "g"))!.join("-");
}

/**
 * Normaliza lo que teclea el usuario: mayúsculas, sin espacios ni guiones,
 * O→0 e I/L→1. Devuelve null si no es una clave con formato válido.
 */
export function normalizeLicenseKey(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== LICENSE_LENGTH) return null;
  for (const ch of cleaned) if (!LICENSE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** Clave de aplicación: 256 bits aleatorios en base64url con prefijo reconocible. */
export function generateAppKey(): string {
  return "gkapp_" + randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function secretHint(secret: string): string {
  return secret.slice(-4);
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
