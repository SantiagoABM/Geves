import { readFileSync } from "node:fs";
import { z } from "zod";

const Env = z
  .object({
    DATABASE_URL: z.string().url(),
    SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
    SIGNING_PRIVATE_KEY_FILE: z.string().min(1).optional(),
    SIGNING_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    ISSUER: z.string().min(1).default("gestor-de-claves"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Detrás de un proxy (Caddy) usa 127.0.0.1 para que nadie llegue directo y falsifique la IP. */
    HOST: z.string().min(1).default("127.0.0.1"),
    TRUSTED_IP_HEADER: z
      .string()
      .regex(/^[A-Za-z0-9-]+$/)
      .optional()
      .transform((v) => v?.toLowerCase() || undefined),
  })
  .refine((e) => !!e.SIGNING_PRIVATE_KEY !== !!e.SIGNING_PRIVATE_KEY_FILE, {
    path: ["SIGNING_PRIVATE_KEY | SIGNING_PRIVATE_KEY_FILE (solo una)"],
  });

export type ApiEnv = Omit<z.infer<typeof Env>, "SIGNING_PRIVATE_KEY" | "SIGNING_PRIVATE_KEY_FILE"> & {
  signingPrivateKeyPem: string;
};

function fail(msg: string): never {
  console.error(`[api] ${msg} Revisa el manual (sección 4).`);
  process.exit(1);
}

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const r = Env.safeParse(source);
  if (!r.success) fail(`Configuración incompleta o no válida: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}.`);
  const { SIGNING_PRIVATE_KEY, SIGNING_PRIVATE_KEY_FILE, ...rest } = r.data;
  let pem: string;
  try {
    pem = SIGNING_PRIVATE_KEY_FILE ? readFileSync(SIGNING_PRIVATE_KEY_FILE, "utf8") : SIGNING_PRIVATE_KEY!.replace(/\\n/g, "\n");
  } catch {
    fail(`No se pudo leer SIGNING_PRIVATE_KEY_FILE (${SIGNING_PRIVATE_KEY_FILE}).`);
  }
  if (!pem.includes("BEGIN PRIVATE KEY")) fail("La clave privada de firma no tiene formato PEM PKCS8.");
  return { ...rest, signingPrivateKeyPem: pem };
}
