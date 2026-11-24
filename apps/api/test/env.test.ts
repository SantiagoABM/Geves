import { generateSigningKeys } from "@gk/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadApiEnv } from "../src/env.ts";

let pem: string;
beforeAll(async () => {
  pem = (await generateSigningKeys()).privateKeyPem;
});

const base = () => ({
  DATABASE_URL: "postgres://gk_api:x@127.0.0.1:5432/gestor",
  SIGNING_PRIVATE_KEY: pem,
  SIGNING_KEY_ID: "k-1",
});

describe("loadApiEnv", () => {
  it("por defecto usa hasta 10 conexiones a la base", () => {
    expect(loadApiEnv(base()).DATABASE_POOL_MAX).toBe(10);
  });

  it("DATABASE_POOL_MAX limita las conexiones (pooler de Supabase gratis)", () => {
    expect(loadApiEnv({ ...base(), DATABASE_POOL_MAX: "5" }).DATABASE_POOL_MAX).toBe(5);
  });
});
