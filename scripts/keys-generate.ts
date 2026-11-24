/**
 * Genera el par de claves de firma ES256.
 *   npm run keys:generate                 → escribe en ./secrets
 *   npm run keys:generate -- --out <dir>  → escribe en otra carpeta
 * Nunca sobrescribe claves existentes.
 */
import { generateSigningKeys } from "@gk/core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outArg = process.argv.indexOf("--out");
const outDir = resolve(outArg > -1 && process.argv[outArg + 1] ? process.argv[outArg + 1]! : "secrets");
const privPath = join(outDir, "signing-private.pem");
const pubPath = join(outDir, "signing-public.pem");

if (existsSync(privPath) || existsSync(pubPath)) {
  console.error(`Ya existen claves en ${outDir}. Muévelas o bórralas a mano si de verdad quieres generar otras.`);
  process.exit(1);
}

const { privateKeyPem, publicKeyPem } = await generateSigningKeys();
mkdirSync(outDir, { recursive: true });
writeFileSync(privPath, privateKeyPem, { mode: 0o600 });
writeFileSync(pubPath, publicKeyPem);

const d = new Date();
const kid = `k-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
console.log(`Clave privada: ${privPath}  (SOLO en el servidor de la API; no la compartas)`);
console.log(`Clave pública: ${pubPath}  (va incrustada en cada app)`);
console.log(`SIGNING_KEY_ID sugerido: ${kid}`);
