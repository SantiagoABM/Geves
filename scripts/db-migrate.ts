/** Aplica las migraciones con el usuario dueño de la base (ADMIN_DATABASE_URL). */
import { migrateDatabase } from "@gk/core";
import { loadRootEnv, requireEnv } from "./env.ts";

loadRootEnv();
await migrateDatabase(requireEnv("ADMIN_DATABASE_URL"));
console.log("Migraciones aplicadas.");
