import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteFile, readFileBytes, type FsOps } from "../src/io.js";
import { findColumn, selectTable } from "../src/select.js";
import { parseMarkdown, splitTableRow } from "../src/parse.js";
import { upsert, updateRows, parseJsonObject } from "../src/ops.js";
import { serializeTable } from "../src/format.js";
import { unifiedDiff } from "../src/diff.js";
import { run } from "../src/main.js";
import { EXIT } from "../src/codes.js";
import { commandHelp } from "../src/argv.js";
import { mockIo, withTempDir, writeMd } from "./helpers.js";

describe("io branches", () => {
  it("writeFile failure and windows unlink-rename", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "old");
      const opsFailWrite: FsOps = {
        lstat: fs.lstat,
        readFile: fs.readFile,
        realpath: fs.realpath,
        unlink: fs.unlink,
        rename: fs.rename,
        writeFile: async () => {
          throw new Error("disk full");
        },
      };
      await expect(atomicWriteFile(file, Buffer.from("x"), opsFailWrite)).rejects.toThrow(/cannot write temp/);

      let renamed = 0;
      const opsWin: FsOps = {
        lstat: fs.lstat,
        readFile: fs.readFile,
        realpath: fs.realpath,
        unlink: fs.unlink,
        writeFile: fs.writeFile,
        rename: async (a, b) => {
          renamed++;
          if (renamed === 1) {
            const err = new Error("eexist") as NodeJS.ErrnoException;
            err.code = "EEXIST";
            throw err;
          }
          return fs.rename(a, b);
        },
      };
      await atomicWriteFile(file, Buffer.from("win"), opsWin, "win32");
      expect((await fs.readFile(file)).toString()).toBe("win");
    });
  });

  it("readFile failure after stat and realpath failure", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "x");
      const ops: FsOps = {
        lstat: fs.lstat,
        readFile: async () => {
          throw new Error("eio");
        },
        writeFile: fs.writeFile,
        rename: fs.rename,
        unlink: fs.unlink,
        realpath: fs.realpath,
      };
      await expect(readFileBytes(file, false, ops)).rejects.toThrow(/cannot read file/);

      const link = path.join(dir, "l.md");
      await fs.symlink(file, link);
      const ops2: FsOps = {
        ...ops,
        lstat: fs.lstat,
        realpath: async () => {
          throw new Error("broken");
        },
      };
      await expect(readFileBytes(link, true, ops2)).rejects.toThrow(/cannot resolve symlink/);
    });
  });

  it("lstat errors other than ENOENT", async () => {
    const ops: FsOps = {
      lstat: async () => {
        const err = new Error("eacces") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      rename: fs.rename,
      unlink: fs.unlink,
      realpath: fs.realpath,
    };
    await expect(readFileBytes("x.md", false, ops)).rejects.toThrow(/cannot stat/);
  });
});

describe("select/ops/format branches", () => {
  it("matches slash path and missing name", () => {
    const doc = parseMarkdown(Buffer.from("# API\n## Errors\n\n| a | b |\n| --- | --- |\n", "utf8"), "t.md");
    expect(selectTable(doc, { table: "API/Errors" }).id).toBe("api-errors-1");
    expect(selectTable(doc, { table: "API > Errors" }).id).toBe("api-errors-1");
    expect(() => selectTable(doc, { table: "nope" })).toThrow(/table not found/);
    expect(() => selectTable(doc, {})).toThrow(/select a table/);
  });

  it("ambiguous column names", () => {
    expect(() => findColumn(["Name", "name"], "NAME", {})).toThrow(/ambiguous column/);
  });

  it("upsert requires key in json; empty set-json; json types", () => {
    const doc = parseMarkdown(Buffer.from("| k | v |\n| --- | --- |\n", "utf8"), "t.md");
    expect(() => upsert(doc, { tableId: "root-1" }, "k", { v: "1" })).toThrow(/key column/);
    expect(() => updateRows(doc, { tableId: "root-1" }, { k: "a" }, {})).toThrow(/set-json/);
    const r = upsert(doc, { tableId: "root-1" }, "k", { k: 3, v: true });
    const n = parseMarkdown(r.bytes);
    expect(n.tables[0]?.rows[0]?.values).toEqual(["3", "true"]);
    expect(() => parseJsonObject("null", "--x")).toThrow(/JSON object/);
  });

  it("serializes EOF table without forcing a final newline", () => {
    const doc = parseMarkdown(Buffer.from("| a | b |\n| --- | --- |"));
    const buf = serializeTable(doc.tables[0]!, Buffer.from("\n"));
    expect(buf.toString("utf8").endsWith("\n")).toBe(false);
  });

  it("unifiedDiff empty sides", () => {
    const d = unifiedDiff({ filePath: "f.md", startLine: 1, oldText: "", newText: "" });
    expect(d).toContain("@@ -1,0 +1,0 @@");
  });
});

describe("cli output branches", () => {
  it("list empty, json mutate, validate human errors, wrote", async () => {
    await withTempDir(async (dir) => {
      const empty = await writeMd(dir, "e.md", "# Hi\n\nno table here.\n");
      const io = mockIo();
      expect(await run(["list", empty], io.io)).toBe(0);
      expect(io.stdout()).toContain("no tables");

      const file = await writeMd(dir, "t.md", "| k | v |\n| --- | --- |\n| a | 1 |\n");
      const js = mockIo();
      expect(
        await run(
          ["upsert", file, "--table-id", "root-1", "--key", "k", "--row-json", '{"k":"a","v":"2"}', "--json"],
          js.io,
        ),
      ).toBe(0);
      expect(JSON.parse(js.stdout()).ok).toBe(true);
      expect(JSON.parse(js.stdout()).data.diff).toContain("@@");

      const wr = mockIo();
      expect(
        await run(
          ["upsert", file, "--table-id", "root-1", "--key", "k", "--row-json", '{"k":"a","v":"2"}', "--write"],
          wr.io,
        ),
      ).toBe(0);
      expect(wr.stdout()).toMatch(/wrote|unchanged/);

      const val = mockIo();
      const dup = await writeMd(dir, "d.md", "| k | v |\n| --- | --- |\n| 1 | a |\n| 1 | b |\n");
      expect(await run(["validate", dup, "--table-id", "root-1", "--unique", "k"], val.io)).toBe(
        EXIT.validation,
      );
      expect(val.stdout()).toContain("error");
    });
  });

  it("commandHelp default", () => {
    expect(commandHelp("list").length).toBeGreaterThan(10);
  });
});

describe("more branches", () => {
  it("matches root slug; ambiguous cloned ids", () => {
    const doc = parseMarkdown(Buffer.from("| a | b |\n| --- | --- |\n| 1 | 2 |\n"), "t.md");
    expect(selectTable(doc, { table: "root" }).id).toBe("root-1");
    const clone = { ...doc.tables[0]! };
    doc.tables.push(clone);
    expect(() => selectTable(doc, { tableId: "root-1" })).toThrow(/ambiguous table id/);
  });

  it("object cell values and escaped trailing pipe", () => {
    const doc = parseMarkdown(Buffer.from("| k | v |\n| --- | --- |\n", "utf8"), "t.md");
    const r = upsert(doc, { tableId: "root-1" }, "k", { k: "x", v: { n: 1 } });
    expect(parseMarkdown(r.bytes).tables[0]?.rows[0]?.values[1]).toContain("{");
    const split = splitTableRow("| a | b\\|");
    expect(split).not.toBeNull();
    expect(split!.cells.map((c) => c.trim().replace("\\|", "|"))).toEqual(["a", "b|"]);
  });
});
