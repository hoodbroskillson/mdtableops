#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EXIT } from "./codes.js";
export { run } from "./main.js";
import { run } from "./main.js";

function isDirectRun(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(argv1)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      process.stderr.write(`mdtableops: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.error);
    },
  );
}
