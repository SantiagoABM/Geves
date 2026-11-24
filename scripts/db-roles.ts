/**
 * Crea o actualiza el usuario de base de datos de la API (gk_api) con permisos mínimos.
 * Usa ADMIN_DATABASE_URL. Si API_DB_PASSWORD no existe, genera una y la muestra una sola vez.
 * Vuelve a ejecutarlo tras cada migración que añada tablas.
 */
import { API_ROLE, applyApiRoleGrants, createPostgresDb } from "@gk/core";
import { randomBytes } from "node:crypto";
import { loadRootEnv, requireEnv } from "./env.ts";

loadRootEnv();
const adminUrl = requireEnv("ADMIN_DATABASE_URL");
const generated = !process.env.API_DB_PASSWORD;
const password = process.env.API_DB_PASSWORD || randomBytes(24).toString("base64url");

const db = createPostgresDb(adminUrl, 1);
await applyApiRoleGrants(db, password);
await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();

const u = new URL(adminUrl);
const apiUrl = `${u.protocol}//${API_ROLE}:${generated ? password : "<API_DB_PASSWORD>"}@${u.host}${u.pathname}${u.search}`;
console.log(`Rol ${API_ROLE} listo con permisos mínimos.`);
if (generated) console.log("Contraseña generada (guárdala, no se vuelve a mostrar).");
console.log(`DATABASE_URL para la API (ajusta el host si la API corre en otra máquina):\n  ${apiUrl}`);
