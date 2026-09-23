import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { appSettings } from "./schema";
import { createTestDb } from "./testing";

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

describe("banco de teste", () => {
  it("aplica as migrações e grava/lê dados", async () => {
    const t = await createTestDb();
    close = t.close;

    await t.db.insert(appSettings).values({ key: "fuso", value: "America/Sao_Paulo" });
    const [row] = await t.db.select().from(appSettings).where(eq(appSettings.key, "fuso"));

    expect(row.value).toBe("America/Sao_Paulo");
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("cada banco de teste é isolado", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(appSettings)).toEqual([]);
  });
});

describe("getDb", () => {
  it("exige DATABASE_URL", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { getDb } = await import("./client");
      expect(() => getDb()).toThrow("DATABASE_URL");
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });
});
