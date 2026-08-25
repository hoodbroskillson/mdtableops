import { Writable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";

export function mockIo() {
  let out = "";
  let err = "";
  const make = (which: "out" | "err") =>
    new Writable({
      write(chunk, _enc, cb) {
        const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        if (which === "out") out += s;
        else err += s;
        cb();
      },
    });
  return {
    io: { stdout: make("out"), stderr: make("err") },
    stdout: () => out,
    stderr: () => err,
  };
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdtableops-"));
  return fn(dir);
}

export async function writeMd(dir: string, name: string, content: string | Buffer): Promise<string> {
  const p = path.join(dir, name);
  await writeFile(p, content);
  return p;
}

export { readFile };
