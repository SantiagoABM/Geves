import { describe, expect, it } from "vitest";
import {
  generateAppKey,
  generateLicenseKey,
  hashSecret,
  normalizeLicenseKey,
  safeEqualHex,
  secretHint,
} from "../src/index.ts";

describe("generateLicenseKey", () => {
  it("produce 5 grupos de 5 caracteres Crockford", () => {
    expect(generateLicenseKey()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  });

  it("no repite valores en 1000 llamadas", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateLicenseKey()));
    expect(keys.size).toBe(1000);
  });
});

describe("normalizeLicenseKey", () => {
  it("acepta minúsculas, espacios y O en lugar de 0", () => {
    expect(normalizeLicenseKey(" abcde-fghjk-mnpqr-stvwx-yz0o1 ")).toBe("ABCDEFGHJKMNPQRSTVWXYZ001");
  });

  it("convierte I y L en 1", () => {
    expect(normalizeLicenseKey("ilIL0-00000-00000-00000-00000")).toBe("1111000000000000000000000");
  });

  it("acepta la clave sin guiones", () => {
    const key = generateLicenseKey();
    expect(normalizeLicenseKey(key.replaceAll("-", "").toLowerCase())).toBe(key.replaceAll("-", ""));
  });

  it("rechaza longitudes incorrectas", () => {
    expect(normalizeLicenseKey("ABC")).toBeNull();
  });

  it("rechaza caracteres fuera del alfabeto", () => {
    expect(normalizeLicenseKey("ABCDE-FGHJK-MNPQR-STVWX-YZ00U")).toBeNull();
  });
});

describe("generateAppKey", () => {
  it("empieza por gkapp_ y mide 49 caracteres", () => {
    const key = generateAppKey();
    expect(key.startsWith("gkapp_")).toBe(true);
    expect(key).toHaveLength(49);
  });
});

describe("hashSecret / secretHint / safeEqualHex", () => {
  it("calcula SHA-256 en hex", () => {
    expect(hashSecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("devuelve los últimos 4 caracteres", () => {
    expect(secretHint("ABCDE-FGHJK")).toBe("GHJK");
  });

  it("compara en tiempo constante", () => {
    expect(safeEqualHex("aa", "aa")).toBe(true);
    expect(safeEqualHex("aa", "ab")).toBe(false);
    expect(safeEqualHex("aa", "aaa")).toBe(false);
  });
});
