import { describe, expect, it } from "vitest";
import { parseArgv, commandHelp } from "../src/argv.js";
import { AppError } from "../src/errors.js";
import { EXIT } from "../src/codes.js";
import { formatError } from "../src/errors.js";
import { unifiedDiff } from "../src/diff.js";
import { escapeCell, formatTable } from "../src/format.js";
import { findColumn } from "../src/select.js";
import { okEnvelope, errEnvelope } from "../src/envelope.js";

describe("parseArgv", () => {
  it("parses flags in any order", () => {
    const a = parseArgv(["--json", "list", "f.md", "--follow-symlinks"]);
    expect(a.command).toBe("list");
    expect(a.file).toBe("f.md");
    expect(a.json).toBe(true);
    expect(a.followSymlinks).toBe(true);
  });
  it("rejects unknown options and extra args", () => {
    expect(() => parseArgv(["list", "f", "--nope"])).toThrow(AppError);
    expect(() => parseArgv(["list", "a", "b"])).toThrow(/extra/);
    expect(() => parseArgv(["--table"])).toThrow(/missing value/);
  });
  it("csv flags", () => {
    const a = parseArgv(["validate", "f", "--required", "a, b", "--unique", "a,b"]);
    expect(a.required).toEqual(["a", "b"]);
    expect(a.unique).toEqual(["a", "b"]);
  });
  it("command help strings cover every command", () => {
    for (const c of ["list", "read", "upsert", "update", "delete", "validate", "sort", "dedupe"] as const) {
      expect(commandHelp(c).length).toBeGreaterThan(20);
    }
  });
});

describe("format/diff/envelope/errors", () => {
  it("escapes pipes and builds a table", () => {
    expect(escapeCell("a|b")).toBe("a\\|b");
    const lines = formatTable({
      columns: ["a", "b"],
      alignments: ["left", "right"],
      rows: [{ values: ["1", "2"] }],
      outerPipes: true,
    });
    expect(lines[0]?.startsWith("|")).toBe(true);
    expect(lines[1]).toContain(":");
  });
  it("unifiedDiff and envelopes", () => {
    const d = unifiedDiff({ filePath: "f.md", startLine: 3, oldText: "a\n", newText: "b\n" });
    expect(d).toContain("@@ -3,1 +3,1 @@");
    expect(okEnvelope({ x: 1 }, false).ok).toBe(true);
    expect(errEnvelope([{ level: "error", message: "e" }]).ok).toBe(false);
    const err = new AppError("boom", EXIT.error, { file: "f.md", table: "t", column: "c", line: 9 });
    expect(formatError(err)).toContain("line: 9");
  });
  it("findColumn case-insensitive unique", () => {
    expect(findColumn(["Name", "Status"], "name", {})).toBe(0);
    expect(() => findColumn(["a"], "z", { file: "f" })).toThrow(/column not found/);
  });
});
