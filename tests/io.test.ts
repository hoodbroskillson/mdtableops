import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteFile, detectNewline, readFileBytes, type FsOps } from "../src/io.js";
import { EXIT } from "../src/codes.js";
import { AppError } from "../src/errors.js";
import { withTempDir, writeMd } from "./helpers.js";

describe("detectNewline", () => {
  it("detects lf, crlf, cr, and default", () => {
    expect(detectNewline(Buffer.from("a\nb")).toString()).toBe("\n");
    expect(detectNewline(Buffer.from("a\r\nb")).toString()).toBe("\r\n");
    expect(detectNewline(Buffer.from("a\rb")).toString()).toBe("\r");
    expect(detectNewline(Buffer.from("none")).toString()).toBe("\n");
  });
});

describe("readFileBytes / symlinks", () => {
  it("refuses symlinks without follow", async () => {
    await withTempDir(async (dir) => {
      const real = await writeMd(dir, "real.md", "| a | b |\n| --- | --- |\n");
      const link = path.join(dir, "link.md");
      await fs.symlink(real, link);
      try {
        await readFileBytes(link, false);
        throw new Error("expected throw");
      } catch (e) {
        expect((e as AppError).exitCode).toBe(EXIT.symlink);
      }
      const followed = await readFileBytes(link, true);
      expect(followed.bytes.toString("utf8")).toContain("| a | b |");
    });
  });
  it("errors on missing file", async () => {
    try {
      await readFileBytes("/no/such/mdtableops-file-xyz.md", false);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AppError).exitCode).toBe(EXIT.error);
    }
  });
});

function failingRenameOps(): FsOps {
  return {
    lstat: fs.lstat,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    realpath: fs.realpath,
    unlink: fs.unlink,
    rename: async () => {
      const err = new Error("simulated rename failure") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    },
  };
}

describe("atomicWriteFile", () => {
  it("replaces the file contents", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "old");
      await atomicWriteFile(file, Buffer.from("new"));
      expect((await fs.readFile(file)).toString()).toBe("new");
    });
  });
  it("leaves the original intact when rename fails", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "original");
      const ops = failingRenameOps();
      await expect(atomicWriteFile(file, Buffer.from("mutated"), ops, "win32")).rejects.toThrow(
        /atomic replace failed/,
      );
      expect((await fs.readFile(file)).toString()).toBe("original");
    });
  });
  it("calls atomicWriteFile with platform win32 when rename always throws and dest still reads original", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "original");
      const ops = failingRenameOps();
      try {
        await atomicWriteFile(file, Buffer.from("mutated"), ops, "win32");
        throw new Error("expected throw");
      } catch (e) {
        expect((e as Error).message).toMatch(/atomic replace failed \(original file unchanged\)/);
      }
      expect((await fs.readFile(file)).toString()).toBe("original");
    });
  });
  it("leaves the original intact when posix rename fails", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "original");
      const ops = failingRenameOps();
      await expect(atomicWriteFile(file, Buffer.from("mutated"), ops, "linux")).rejects.toThrow(
        /atomic replace failed \(original file unchanged\)/,
      );
      expect((await fs.readFile(file)).toString()).toBe("original");
    });
  });
  it("does not claim original unchanged if dest cannot be restored", async () => {
    await withTempDir(async (dir) => {
      const file = await writeMd(dir, "t.md", "original");
      let writes = 0;
      const ops: FsOps = {
        lstat: fs.lstat,
        readFile: fs.readFile,
        realpath: fs.realpath,
        unlink: fs.unlink,
        writeFile: async (p, d) => {
          writes += 1;
          if (writes <= 2) return fs.writeFile(p, d);
          throw new Error("restore failed");
        },
        rename: async () => {
          const err = new Error("simulated rename failure") as NodeJS.ErrnoException;
          err.code = "EPERM";
          throw err;
        },
      };
      await expect(atomicWriteFile(file, Buffer.from("mutated"), ops, "win32")).rejects.toThrow(
        /^atomic replace failed: /,
      );
    });
  });
});
