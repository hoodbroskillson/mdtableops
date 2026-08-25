import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "../src/parse.js";
import { validateTable, upsert } from "../src/ops.js";
import { formatTable } from "../src/format.js";

const dir = fileURLToPath(new URL("./fixtures", import.meta.url));

function load(name: string) {
  return parseMarkdown(readFileSync(path.join(dir, name)), name);
}

describe("fixtures", () => {
  it("basic.md finds two tables and stable ids", () => {
    const doc = load("basic.md");
    expect(doc.tables.map((t) => t.id)).toEqual(["compatibility-1", "compatibility-extra-1"]);
    expect(doc.tables[0]?.columns).toEqual(["Name", "Status", "Notes"]);
  });
  it("malformed.md only parses the real table", () => {
    const doc = load("malformed.md");
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.id).toBe("real-1");
  });
  it("escaped pipes and inline code stay one cell", () => {
    const doc = load("escaped.md");
    expect(doc.tables[0]?.rows[0]?.values[0]).toContain("|");
    expect(doc.tables[0]?.rows[1]?.values[0]).toBe("x|y");
  });
  it("duplicate headers warn on validate", () => {
    const doc = load("duplicate-headers.md");
    const r = validateTable(doc, { tableId: "root-1" }, ["Name"], []);
    expect(r.diagnostics.some((d) => /duplicate header/.test(d.message))).toBe(true);
  });
  it("upsert in basic.md leaves frontmatter and extra table bytes intact", () => {
    const buf = readFileSync(path.join(dir, "basic.md"));
    const doc = parseMarkdown(buf, "basic.md");
    const target = doc.tables[0]!;
    const prefix = buf.subarray(0, target.startOffset);
    const suffix = buf.subarray(target.endOffset);
    const result = upsert(doc, { tableId: "compatibility-1" }, "Name", {
      Name: "alpha",
      Status: "new",
    });
    expect(result.bytes.subarray(0, prefix.length).equals(prefix)).toBe(true);
    expect(result.bytes.subarray(result.bytes.length - suffix.length).equals(suffix)).toBe(true);
  });
});

describe("format without outer pipes", () => {
  it("omits wrapping pipes when original had none", () => {
    const lines = formatTable({
      columns: ["a", "b"],
      alignments: ["none", "none"],
      rows: [{ values: ["1", "2"] }],
      outerPipes: false,
    });
    expect(lines[0]?.startsWith("|")).toBe(false);
    expect(lines[0]).toContain("|");
  });
});
