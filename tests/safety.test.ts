import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/parse.js";
import { upsert, deleteRows, updateRows } from "../src/ops.js";
import { serializeTable } from "../src/format.js";

const PREFIX = "# Title\n\nintro **bold** and a [link](http://x.test).\n\n";
const TABLE = "| sku | name |\n| --- | ---- |\n| A1  | widget |\n| B2  | gadget |\n";
const SUFFIX = "\n## After\n\ntrailing prose, a fence:\n\n```\n| not | a | table |\n| --- | --- |\n```\n\nend.\n";

describe("byte-range isolation", () => {
  it("a mutation changes only the exact byte range of the target table", () => {
    const original = Buffer.from(PREFIX + TABLE + SUFFIX, "utf8");
    const doc = parseMarkdown(original, "doc.md");
    expect(doc.tables).toHaveLength(1);
    const table = doc.tables[0]!;
    const prefix = original.subarray(0, table.startOffset);
    const suffix = original.subarray(table.endOffset);
    expect(original.subarray(table.startOffset, table.endOffset).equals(table.source)).toBe(true);

    const result = upsert(doc, { tableId: table.id }, "sku", { sku: "A1", name: "WIDGET" });
    expect(result.changed).toBe(true);
    const after = result.bytes;
    expect(after.subarray(0, prefix.length).equals(prefix)).toBe(true);
    expect(after.subarray(after.length - suffix.length).equals(suffix)).toBe(true);
    const middle = after.subarray(prefix.length, after.length - suffix.length);
    expect(middle.equals(prefix)).toBe(false);
    expect(middle.toString("utf8")).toContain("WIDGET");
    expect(middle.toString("utf8")).not.toContain("intro");
    expect(after.toString("utf8")).toContain("intro **bold**");
    expect(after.toString("utf8")).toContain("trailing prose");
    expect(after.toString("utf8")).toContain("| not | a | table |");
  });

  it("preserves CRLF outside and inside the rewritten table", () => {
    const body = PREFIX.replace(/\n/g, "\r\n") + TABLE.replace(/\n/g, "\r\n") + SUFFIX.replace(/\n/g, "\r\n");
    const original = Buffer.from(body, "utf8");
    const doc = parseMarkdown(original, "crlf.md");
    const table = doc.tables[0]!;
    const result = deleteRows(doc, { tableId: table.id }, { sku: "B2" });
    expect(result.bytes.includes(Buffer.from("\r\n"))).toBe(true);
    expect(result.bytes.toString("utf8")).not.toMatch(/(?<!\r)\n/);
    const again = parseMarkdown(result.bytes, "crlf.md");
    expect(again.tables[0]?.rows).toHaveLength(1);
  });

  it("does not rewrite when the patch is a no-op", () => {
    const original = Buffer.from(PREFIX + TABLE + SUFFIX, "utf8");
    const doc = parseMarkdown(original, "doc.md");
    const result = updateRows(doc, { tableId: "title-1" }, { sku: "A1" }, { name: "widget" });
    const prefix = original.subarray(0, doc.tables[0]!.startOffset);
    const suffix = original.subarray(doc.tables[0]!.endOffset);
    expect(result.bytes.subarray(0, prefix.length).equals(prefix)).toBe(true);
    expect(result.bytes.subarray(result.bytes.length - suffix.length).equals(suffix)).toBe(true);
    const parsed = parseMarkdown(result.bytes);
    expect(parsed.tables[0]?.rows[0]?.values[1]).toBe("widget");
  });

  it("serialize uses file newline convention", () => {
    const doc = parseMarkdown(Buffer.from("| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n", "utf8"));
    const buf = serializeTable(doc.tables[0]!, doc.newline);
    expect(buf.toString("utf8")).toContain("\r\n");
  });
});
