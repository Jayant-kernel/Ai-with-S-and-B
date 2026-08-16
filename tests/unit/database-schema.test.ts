import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../../database/001_saathi_memory.sql", import.meta.url),
);
const schema = readFileSync(schemaPath, "utf8").toLowerCase();

describe("saathi memory schema", () => {
  it.each([
    "elders",
    "memory_items",
    "reminder_drafts",
    "reminder_events",
    "safety_audit_events",
  ])("enables row level security on %s", (table) => {
    expect(schema).toContain(`alter table ${table} enable row level security`);
  });

  it("defines no public policies yet", () => {
    expect(schema).not.toMatch(/create policy/);
  });

  it("keeps memory_items.updated_at current with a trigger", () => {
    expect(schema).toContain("create trigger memory_items_set_updated_at");
    expect(schema).toContain("before update on memory_items");
    expect(schema).toMatch(/new\.updated_at\s*=\s*now\(\)/);
  });

  it("pins a safe search_path on the trigger function", () => {
    expect(schema).toMatch(/set search_path\s*=\s*''/);
  });
});
