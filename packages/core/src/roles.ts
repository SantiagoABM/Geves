import { sql } from "drizzle-orm";
import type { Db } from "./db.ts";

export const API_ROLE = "gk_api";
const PASSWORD_RE = /^[A-Za-z0-9_-]{24,128}$/;

/**
 * Crea o actualiza el rol de la API pública con los permisos mínimos:
 * leer apps y claves, registrar dispositivos y escribir el log.
 * No puede crear, modificar ni revocar apps o claves.
 */
export async function applyApiRoleGrants(db: Db, password: string): Promise<void> {
  // La contraseña se interpola en SQL (CREATE ROLE no admite parámetros), así que se restringe su formato.
  if (!PASSWORD_RE.test(password)) {
    throw new Error("La contraseña del rol de la API debe tener 24-128 caracteres [A-Za-z0-9_-].");
  }
  const statements = [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${API_ROLE}') THEN
         CREATE ROLE ${API_ROLE} LOGIN PASSWORD '${password}';
       ELSE
         ALTER ROLE ${API_ROLE} WITH LOGIN PASSWORD '${password}';
       END IF;
     END $$`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${API_ROLE}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${API_ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${API_ROLE}`,
    `GRANT SELECT ON apps, license_keys TO ${API_ROLE}`,
    `GRANT SELECT, INSERT, UPDATE ON devices TO ${API_ROLE}`,
    `GRANT SELECT, INSERT ON verification_log TO ${API_ROLE}`,
    `GRANT USAGE ON SEQUENCE verification_log_id_seq TO ${API_ROLE}`,
  ];
  for (const s of statements) await db.execute(sql.raw(s));
}
