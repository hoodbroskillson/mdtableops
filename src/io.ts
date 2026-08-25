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

function siblingPath(filePath: string, ext: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(
    dir,
    `.${base}.mdtableops-${process.pid}-${randomBytes(6).toString("hex")}${ext}`,
  );
}

function asBuffer(bytes: string | Buffer): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

async function destMatchesOriginal(
  ops: FsOps,
  filePath: string,
  original: Buffer,
): Promise<boolean> {
  try {
    const bytes = await ops.readFile(filePath);
    return asBuffer(bytes).equals(original);
  } catch {
    return false;
  }
}

function atomicReplaceError(filePath: string, err: unknown, originalUnchanged: boolean): AppError {
  const why = (err as Error).message;
  const msg = originalUnchanged
    ? `atomic replace failed (original file unchanged): ${filePath}: ${why}`
    : `atomic replace failed: ${filePath}: ${why}`;
  return new AppError(msg, EXIT.error, { file: filePath });
}

async function restoreDestFromBak(
  ops: FsOps,
  filePath: string,
  bak: string,
  original: Buffer,
): Promise<void> {
  try {
    let bytes = original;
    try {
      bytes = asBuffer(await ops.readFile(bak));
    } catch {
      bytes = original;
    }
    await ops.writeFile(filePath, bytes);
    await ops.unlink(bak).catch(() => undefined);
  } catch {
    // Leave bak in place if dest could not be restored.
  }
}

/**
 * Atomic replace: write a temp file in the same directory, then rename.
 * On Windows, if rename fails: copy dest to a sibling .bak, unlink dest,
 * rename tmp onto dest, then unlink the bak. If anything after the backup
 * fails, dest is restored from the bak when possible.
 * The error message claims the original is unchanged only when dest still
 * exists with the original bytes.
 */
export async function atomicWriteFile(
  filePath: string,
  data: Buffer,
  ops: FsOps = defaultFs,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const tmp = siblingPath(filePath, ".tmp");
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
    await ops.rename(tmp, filePath);
    return;
  } catch (renameErr) {
    if (platform !== "win32") {
      await ops.unlink(tmp).catch(() => undefined);
      throw atomicReplaceError(filePath, renameErr, true);
    }
  }

  const bak = siblingPath(filePath, ".bak");
  let original: Buffer | undefined;
  try {
    original = asBuffer(await ops.readFile(filePath));
    await ops.writeFile(bak, original);
  } catch (backupErr) {
    await ops.unlink(tmp).catch(() => undefined);
    await ops.unlink(bak).catch(() => undefined);
    const unchanged =
      original !== undefined && (await destMatchesOriginal(ops, filePath, original));
    throw atomicReplaceError(filePath, backupErr, unchanged);
  }

  try {
    await ops.unlink(filePath);
    await ops.rename(tmp, filePath);
  } catch (replaceErr) {
    await restoreDestFromBak(ops, filePath, bak, original);
    await ops.unlink(tmp).catch(() => undefined);
    const unchanged = await destMatchesOriginal(ops, filePath, original);
    throw atomicReplaceError(filePath, replaceErr, unchanged);
  }

  await ops.unlink(bak).catch(() => undefined);
}
