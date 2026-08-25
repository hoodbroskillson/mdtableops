import { run } from "../src/cli.js";
import { EXIT } from "../src/codes.js";

const idx = process.argv.findIndex((a) => a.includes("spawn-entry"));
const args = idx >= 0 ? process.argv.slice(idx + 1) : process.argv.slice(2);
const code = await run(args);
process.exit(code === undefined ? EXIT.error : code);
