import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { EXIT } from "./codes.js";
import { AppError } from "./errors.js";

export interface FsOps {
  lstat: typeof fs.lstat;
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
  rename: typeof fs.rename;
  unlink: typeof fs.unlink;
  realpath: typeof fs.realpath;
}

const defaultFs: FsOps = {
  lstat: fs.lstat,
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
  unlink: fs.unlink,
  realpath: fs.realpath,
};

export function detectNewline(bytes: Buffer): Buffer {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d) {
      if (i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
        return Buffer.from("\r\n");
      }
      return Buffer.from("\r");
    }
    if (bytes[i] === 0x0a) {
      return Buffer.from("\n");
    }
  }
  return Buffer.from("\n");
}

export async function resolveReadPath(
  filePath: string,
  followSymlinks: boolean,
  ops: FsOps = defaultFs,
): Promise<string> {
  let st;
  try {
    st = await ops.lstat(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AppError(`file not found: ${filePath}`, EXIT.error, { file: filePath });
    }
    throw new AppError(
      `cannot stat file: ${filePath}: ${(err as Error).message}`,
      EXIT.error,
      { file: filePath },
    );
  }
  if (st.isSymbolicLink()) {
    if (!followSymlinks) {
      throw new AppError(
        `refusing to operate on symlink (pass --follow-symlinks to allow): ${filePath}`,
        EXIT.symlink,
        { file: filePath },
      );
    }
    try {
      return await ops.realpath(filePath);
    } catch (err) {
      throw new AppError(
        `cannot resolve symlink: ${filePath}: ${(err as Error).message}`,
        EXIT.error,
        { file: filePath },
      );
    }
  }
  if (!st.isFile()) {
    throw new AppError(`not a regular file: ${filePath}`, EXIT.error, { file: filePath });
  }
  return filePath;
}

export async function readFileBytes(
  filePath: string,
  followSymlinks: boolean,
  ops: FsOps = defaultFs,
): Promise<{ path: string; bytes: Buffer }> {
  const resolved = await resolveReadPath(filePath, followSymlinks, ops);
  try {
    const bytes = await ops.readFile(resolved);
    return { path: resolved, bytes };
  } catch (err) {
    throw new AppError(
      `cannot read file: ${resolved}: ${(err as Error).message}`,
      EXIT.error,
      { file: resolved },
    );
  }
}

/**
 * Atomic replace: write a temp file in the same directory, then rename.
 * On Windows, unlink the destination first if rename fails.
 * The original file is left unchanged if the write/rename fails.
 */
export async function atomicWriteFile(
  filePath: string,
  data: Buffer,
  ops: FsOps = defaultFs,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(
    dir,
    `.${base}.mdtableops-${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await ops.writeFile(tmp, data);
  } catch (err) {
    await ops.unlink(tmp).catch(() => undefined);
    throw new AppError(
      `cannot write temp file: ${tmp}: ${(err as Error).message}`,
      EXIT.error,
      { file: filePath },
    );
  }
  try {
    try {
      await ops.rename(tmp, filePath);
    } catch (err) {
      if (platform === "win32") {
        await ops.unlink(filePath);
        await ops.rename(tmp, filePath);
      } else {
        throw err;
      }
    }
  } catch (err) {
    await ops.unlink(tmp).catch(() => undefined);
    throw new AppError(
      `atomic replace failed (original file unchanged): ${filePath}: ${(err as Error).message}`,
      EXIT.error,
      { file: filePath },
    );
  }
}
