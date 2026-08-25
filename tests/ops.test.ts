import { describe, expect, it } from "vitest";
import { EXIT } from "../src/codes.js";
import { AppError } from "../src/errors.js";
import {
  dedupeRows,
  deleteRows,
  listTables,
  parseJsonObject,
  parseMarkdown,
  readTableData,
  sortRows,
  updateRows,
  upsert,
  validateTable,
} from "../src/ops.js";
import { selectTable } from "../src/select.js";

const sample = `# Inventory

| sku | qty | loc |
| --- | ---: | --- |
| A1  |   2 | us  |
| B2  |   5 | eu  |
| A1  |   9 | eu  |

# Notes

hello
`;

function doc(s = sample) {
  return parseMarkdown(Buffer.from(s, "utf8"), "inv.md");
}

describe("list/read", () => {
  it("lists tables with required fields", () => {
    const items = listTables(doc());
    expect(items).toHaveLength(1);
    const t = items[0]!;
    expect(t.id).toBe("inventory-1");
    expect(t.headingPath).toEqual(["Inventory"]);
    expect(t.documentIndex).toBe(1);
    expect(t.headingIndex).toBe(1);
    expect(t.columns).toEqual(["sku", "qty", "loc"]);
    expect(t.rowCount).toBe(3);
    expect(t.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(t.startLine).toBe(3);
  });
  it("reads rows as objects", () => {
    const data = readTableData(doc(), { table: "Inventory" });
    expect(data.rows[0]).toEqual({ sku: "A1", qty: "2", loc: "us" });
  });
});

describe("select", () => {
  it("refuses ambiguous heading matches", () => {
    const d = doc(`# Dup

| a | b |
| --- | --- |
| 1 | 2 |

| a | b |
| --- | --- |
| 3 | 4 |
`);
    expect(() => selectTable(d, { table: "Dup" })).toThrow(AppError);
    try {
      selectTable(d, { table: "Dup" });
    } catch (e) {
      expect((e as AppError).exitCode).toBe(EXIT.ambiguous);
    }
    const t = selectTable(d, { tableId: "dup-1" });
    expect(t.startLine).toBe(3);
  });
  it("missing table is exit 3", () => {
    try {
      selectTable(doc(), { tableId: "nope" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AppError).exitCode).toBe(EXIT.missingTable);
    }
  });
});

describe("upsert/update/delete", () => {
  it("updates an existing key and inserts a missing key", () => {
    const d = doc(`| k | v |
| --- | --- |
| a | 1 |
`);
    const up = upsert(d, { tableId: "root-1" }, "k", { k: "a", v: "9" });
    expect(up.changed).toBe(true);
    const next = parseMarkdown(up.bytes, "inv.md");
    expect(next.tables[0]?.rows[0]?.values).toEqual(["a", "9"]);
    const ins = upsert(next, { tableId: "root-1" }, "k", { k: "b", v: "2" });
    const next2 = parseMarkdown(ins.bytes, "inv.md");
    expect(next2.tables[0]?.rows.map((r) => r.values[0])).toEqual(["a", "b"]);
  });
  it("refuses duplicate keys on upsert", () => {
    const d = doc();
    expect(() => upsert(d, { table: "Inventory" }, "sku", { sku: "A1", qty: "0" })).toThrow(/duplicate key/);
  });
  it("updates matching rows and deletes them", () => {
    const d = doc();
    const u = updateRows(d, { table: "Inventory" }, { loc: "eu" }, { qty: "0" });
    const n = parseMarkdown(u.bytes, "inv.md");
    expect(n.tables[0]?.rows.filter((r) => r.values[2] === "eu").every((r) => r.values[1] === "0")).toBe(true);
    const del = deleteRows(n, { table: "Inventory" }, { loc: "eu" });
    const n2 = parseMarkdown(del.bytes, "inv.md");
    expect(n2.tables[0]?.rows).toHaveLength(1);
    expect(n2.tables[0]?.rows[0]?.values[0]).toBe("A1");
  });
  it("refuses empty where", () => {
    expect(() => updateRows(doc(), { table: "Inventory" }, {}, { qty: "1" })).toThrow(/where-json/);
    expect(() => deleteRows(doc(), { table: "Inventory" }, {})).toThrow(/where-json/);
  });
});

describe("sort/dedupe/validate", () => {
  it("sorts lexicographically and numerically", () => {
    const d = doc(`| n | s |
| --- | --- |
| 10 | b |
| 2 | a |
`);
    const num = sortRows(d, { tableId: "root-1" }, "n");
    expect(parseMarkdown(num.bytes).tables[0]?.rows.map((r) => r.values[0])).toEqual(["2", "10"]);
    const lex = sortRows(d, { tableId: "root-1" }, "s");
    expect(parseMarkdown(lex.bytes).tables[0]?.rows.map((r) => r.values[1])).toEqual(["a", "b"]);
  });
  it("dedupes keeping first", () => {
    const r = dedupeRows(doc(), { table: "Inventory" }, "sku");
    const n = parseMarkdown(r.bytes);
    expect(n.tables[0]?.rows.map((r) => r.values[0])).toEqual(["A1", "B2"]);
    expect(r.rowsAffected).toBe(1);
  });
  it("validate required and unique", () => {
    const ok = validateTable(doc(), { table: "Inventory" }, ["sku"], ["sku", "loc"]);
    expect(ok.ok).toBe(true);
    const bad = validateTable(doc(), { table: "Inventory" }, ["sku"], ["sku"]);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.level === "error")).toBe(true);
    const empty = validateTable(
      doc(`| a | b |
| --- | --- |
|  | x |
`),
      { tableId: "root-1" },
      ["a"],
      [],
    );
    expect(empty.ok).toBe(false);
  });
});

describe("parseJsonObject", () => {
  it("rejects non-objects", () => {
    expect(() => parseJsonObject("[]", "--row-json")).toThrow(/JSON object/);
    expect(() => parseJsonObject("{", "--row-json")).toThrow(/invalid/);
  });
});

describe("if-hash", () => {
  it("refuses stale hash", () => {
    const d = doc();
    try {
      upsert(d, { table: "Inventory" }, "sku", { sku: "Z", qty: "1" }, "deadbeef");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AppError).exitCode).toBe(EXIT.hashMismatch);
    }
  });
  it("accepts current hash", () => {
    const d = doc();
    const h = d.tables[0]!.sha256;
    const r = upsert(d, { table: "Inventory" }, "sku", { sku: "Z9", qty: "1", loc: "us" }, h);
    expect(r.changed).toBe(true);
  });
});
