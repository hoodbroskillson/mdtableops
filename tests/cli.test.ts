import { describe, expect, it } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.js";
import { EXIT } from "../src/codes.js";
import { mockIo, withTempDir, writeMd } from "./helpers.js";

const mini = `# Compatibility

| Name | Status |
| ---- | ------ |
| alpha | old |
| beta  | ok  |
`;

describe("cli run()", () => {
  it("prints version and help", async () => {
    const v = mockIo();
    expect(await run(["--version"], v.io)).toBe(0);
    expect(v.stdout().trim()).toBe("1.0.0");
    const h = mockIo();
    expect(await run(["--help"], h.io)).toBe(0);
    expect(h.stdout()).toContain("Safe CRUD");
    const ch = mockIo();
    expect(await run(["list", "--help"], ch.io)).toBe(0);
    expect(ch.stdout()).toContain("sha256");
  });

  it("usage on unknown command and missing file", async () => {
    const u = mockIo();
    expect(await run(["nope"], u.io)).toBe(EXIT.usage);
    const m = mockIo();
    expect(await run(["list"], m.io)).toBe(EXIT.usage);
  });

  it("list, read, json envelope", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", mini);
      const list = mockIo();
      expect(await run(["list", file], list.io)).toBe(0);
      expect(list.stdout()).toContain("compatibility-1");
      const js = mockIo();
      expect(await run(["list", file, "--json"], js.io)).toBe(0);
      const env = JSON.parse(js.stdout());
      expect(env.schemaVersion).toBe(1);
      expect(env.ok).toBe(true);
      expect(env.data.tables[0].id).toBe("compatibility-1");
      const read = mockIo();
      expect(await run(["read", file, "--table", "Compatibility", "--json"], read.io)).toBe(0);
      expect(JSON.parse(read.stdout()).data.rows[0].Name).toBe("alpha");
    });
  });

  it("diff without --write; write applies; surrounding bytes stay", async () => {
    await withTempDir(async (dir) => {
      const original = "head\n\n" + mini + "\ntail\n";
      const file = await writeMd(dir, "t.md", original);
      const diff = mockIo();
      expect(
        await run(
          ["upsert", file, "--table", "Compatibility", "--key", "Name", "--row-json", JSON.stringify({ Name: "alpha", Status: "new" })],
          diff.io,
        ),
      ).toBe(0);
      expect(diff.stdout()).toContain("diff");
      expect(diff.stdout()).toContain("--- a/");
      const { readFile } = await import("node:fs/promises");
      expect((await readFile(file, "utf8"))).toBe(original);

      const wr = mockIo();
      expect(
        await run(
          [
            "upsert",
            file,
            "--table-id",
            "compatibility-1",
            "--key",
            "Name",
            "--row-json",
            JSON.stringify({ Name: "alpha", Status: "new" }),
            "--write",
          ],
          wr.io,
        ),
      ).toBe(0);
      const after = await readFile(file);
      expect(after.toString("utf8").startsWith("head\n")).toBe(true);
      expect(after.toString("utf8").endsWith("tail\n")).toBe(true);
      expect(after.toString("utf8")).toContain("new");
    });
  });

  it("exit codes: missing, ambiguous, hash, validate, symlink", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(
        dir,
        "t.md",
        `# A

| k | v |
| --- | --- |
| 1 | x |

| k | v |
| --- | --- |
| 2 | y |
`,
      );
      const miss = mockIo();
      expect(await run(["read", file, "--table-id", "nope"], miss.io)).toBe(EXIT.missingTable);
      const amb = mockIo();
      expect(await run(["read", file, "--table", "A"], amb.io)).toBe(EXIT.ambiguous);
      const stale = mockIo();
      expect(
        await run(["sort", file, "--table-id", "a-1", "--by", "k", "--if-hash", "00"], stale.io),
      ).toBe(EXIT.hashMismatch);
      const val = mockIo();
      expect(await run(["validate", file, "--table-id", "a-1", "--unique", "k,v"], val.io)).toBe(0);
      const dupfile = await writeMd(
        dir,
        "d.md",
        `| k | v |
| --- | --- |
| 1 | a |
| 1 | b |
`,
      );
      const bad = mockIo();
      expect(await run(["validate", dupfile, "--table-id", "root-1", "--unique", "k"], bad.io)).toBe(
        EXIT.validation,
      );

      const fs = await import("node:fs/promises");
      const link = path.join(dir, "l.md");
      await fs.symlink(file, link);
      const sl = mockIo();
      expect(await run(["list", link], sl.io)).toBe(EXIT.symlink);
    });
  });

  it("update delete sort dedupe via cli", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(
        dir,
        "t.md",
        `| n | s |
| --- | --- |
| 2 | b |
| 1 | a |
| 1 | a |
`,
      );
      expect(await run(["sort", file, "--table-id", "root-1", "--by", "n", "--write"], mockIo().io)).toBe(0);
      expect(await run(["dedupe", file, "--table-id", "root-1", "--key", "n", "--write"], mockIo().io)).toBe(0);
      expect(
        await run(
          ["update", file, "--table-id", "root-1", "--where-json", '{"n":"1"}', "--set-json", '{"s":"z"}', "--write"],
          mockIo().io,
        ),
      ).toBe(0);
      expect(
        await run(["delete", file, "--table-id", "root-1", "--where-json", '{"n":"2"}', "--write"], mockIo().io),
      ).toBe(0);
      const read = mockIo();
      await run(["read", file, "--table-id", "root-1", "--json"], read.io);
      const rows = JSON.parse(read.stdout()).data.rows;
      expect(rows).toEqual([{ n: "1", s: "z" }]);
    });
  });

  it("json errors still set exit codes", async () => {
    const io = mockIo();
    const code = await run(["list"], io.io);
    expect(code).toBe(EXIT.usage);
  });
});

describe("cli spawn", () => {
  it("spawns the CLI through vite-node", () => {
    const viteNode = path.join(process.cwd(), "node_modules/vite-node/dist/cli.mjs");
    const entry = fileURLToPath(new URL("./spawn-entry.ts", import.meta.url));
    expect(existsSync(viteNode)).toBe(true);
    const help = spawnSync(process.execPath, [viteNode, entry, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("mdtableops");
    const ver = spawnSync(process.execPath, [viteNode, entry, "--version"], { encoding: "utf8" });
    expect(ver.status).toBe(0);
    expect(ver.stdout.trim()).toBe("1.0.0");
  });
});
