import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT } from "../src/codes.js";
import { parseArgv } from "../src/argv.js";
import { parseMarkdown, openingFence } from "../src/parse.js";
import { selectTable } from "../src/select.js";
import { AppError } from "../src/errors.js";
import { mockIo, withTempDir, writeMd } from "./helpers.js";
import { sha256 } from "../src/hash.js";
import { detectNewline } from "../src/io.js";

describe("extra coverage", () => {
  it("json usage error envelope", async () => {
    const io = mockIo();
    const code = await run(["--json", "list"], io.io);
    expect(code).toBe(EXIT.usage);
    const env = JSON.parse(io.stdout());
    expect(env.ok).toBe(false);
    expect(env.schemaVersion).toBe(1);
    expect(env.diagnostics[0].level).toBe("error");
  });

  it("missing mutation flags", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n");
      expect(await run(["upsert", file, "--table-id", "root-1"], mockIo().io)).toBe(EXIT.usage);
      expect(await run(["update", file, "--table-id", "root-1"], mockIo().io)).toBe(EXIT.usage);
      expect(await run(["delete", file, "--table-id", "root-1"], mockIo().io)).toBe(EXIT.usage);
      expect(await run(["sort", file, "--table-id", "root-1"], mockIo().io)).toBe(EXIT.usage);
      expect(await run(["dedupe", file, "--table-id", "root-1"], mockIo().io)).toBe(EXIT.usage);
      expect(await run(["read", file], mockIo().io)).toBe(EXIT.usage);
      const badJson = mockIo();
      expect(
        await run(["upsert", file, "--table-id", "root-1", "--key", "a", "--row-json", "{"], badJson.io),
      ).toBe(EXIT.usage);
    });
  });

  it("parseArgv help/version/end of options", () => {
    expect(parseArgv(["help", "list"]).help).toBe(true);
    expect(parseArgv(["--version"]).version).toBe(true);
    const a = parseArgv(["list", "--", "weird.md"]);
    expect(a.file).toBe("weird.md");
  });

  it("openingFence rejects backticks in info", () => {
    expect(openingFence("``` aa ```")).toBeNull();
    expect(openingFence("~~~ aa ``` ~~~")).not.toBeNull();
  });

  it("table+id mismatch and sha256 helper", () => {
    const doc = parseMarkdown(Buffer.from("# A\n\n| a | b |\n| --- | --- |\n", "utf8"), "t.md");
    expect(() => selectTable(doc, { table: "nope", tableId: "a-1" })).toThrow(AppError);
    expect(sha256(Buffer.from("x")).length).toBe(64);
    expect(detectNewline(Buffer.from("")).toString()).toBe("\n");
  });

  it("directory is not a regular file", async () => {
    await withTempDir(async (dir) => {
      const io = mockIo();
      expect(await run(["list", dir], io.io)).toBe(EXIT.error);
    });
  });

  it("validate json failure and human warn", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(
        dir,
        "t.md",
        `| Name | Name |
| ---- | ---- |
| a | b |
| a | c |
`,
      );
      const io = mockIo();
      expect(await run(["validate", file, "--table-id", "root-1", "--required", "Name", "--unique", "Name", "--json"], io.io)).toBe(
        EXIT.validation,
      );
      expect(JSON.parse(io.stdout()).ok).toBe(false);
    });
  });

  it("no command is usage", async () => {
    const io = mockIo();
    expect(await run([], io.io)).toBe(EXIT.usage);
    expect(io.stderr()).toContain("mdtableops");
  });

  it("unknown command via parse", async () => {
    expect(() => parseArgv(["wat", "f.md"])).toThrow(/unknown command/);
  });
});
