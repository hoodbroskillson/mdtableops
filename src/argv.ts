import { usage } from "./errors.js";
import { VERSION } from "./version.js";

export const COMMANDS = [
  "list",
  "read",
  "upsert",
  "update",
  "delete",
  "validate",
  "sort",
  "dedupe",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export interface ParsedArgs {
  command?: CommandName;
  file?: string;
  json: boolean;
  followSymlinks: boolean;
  write: boolean;
  ifHash?: string;
  table?: string;
  tableId?: string;
  key?: string;
  rowJson?: string;
  whereJson?: string;
  setJson?: string;
  required?: string[];
  unique?: string[];
  by?: string;
  help: boolean;
  version: boolean;
}

const FLAGS_WITH_VALUE = new Set([
  "--if-hash",
  "--table",
  "--table-id",
  "--key",
  "--row-json",
  "--where-json",
  "--set-json",
  "--required",
  "--unique",
  "--by",
]);

function isCommand(s: string): s is CommandName {
  return (COMMANDS as readonly string[]).includes(s);
}

function csv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    json: false,
    followSymlinks: false,
    write: false,
    help: false,
    version: false,
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a === "-V" || a === "--version") {
      out.version = true;
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--follow-symlinks") {
      out.followSymlinks = true;
      continue;
    }
    if (a === "--write") {
      out.write = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(a)) {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("-")) {
        throw usage(`missing value for ${a}`);
      }
      i++;
      switch (a) {
        case "--if-hash":
          out.ifHash = val;
          break;
        case "--table":
          out.table = val;
          break;
        case "--table-id":
          out.tableId = val;
          break;
        case "--key":
          out.key = val;
          break;
        case "--row-json":
          out.rowJson = val;
          break;
        case "--where-json":
          out.whereJson = val;
          break;
        case "--set-json":
          out.setJson = val;
          break;
        case "--required":
          out.required = csv(val);
          break;
        case "--unique":
          out.unique = csv(val);
          break;
        case "--by":
          out.by = val;
          break;
      }
      continue;
    }
    if (a.startsWith("-")) {
      throw usage(`unknown option: ${a}`);
    }
    positionals.push(a);
  }
  if (positionals[0] === "help") {
    out.help = true;
    positionals.shift();
  }
  if (positionals[0] && isCommand(positionals[0])) {
    out.command = positionals[0];
    positionals.shift();
  } else if (positionals[0] && !out.help && !out.version) {
    throw usage(`unknown command: ${positionals[0]}`);
  }
  if (positionals[0]) out.file = positionals[0];
  if (positionals.length > 1) {
    throw usage(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
  }
  return out;
}

export function requireFile(args: ParsedArgs): string {
  if (!args.file) throw usage("missing FILE argument");
  return args.file;
}

export function requireTableSel(args: ParsedArgs): { table?: string; tableId?: string } {
  if (!args.table && !args.tableId) {
    throw usage("select a table with --table NAME or --table-id ID");
  }
  return { table: args.table, tableId: args.tableId };
}

export const HELP_MAIN = `mdtableops ${VERSION} — Safe CRUD operations for Markdown tables, built for AI agents.

Usage:
  mdtableops <command> FILE [options]
  mdtableops --help
  mdtableops --version

Commands:
  list       List tables in FILE
  read       Print one table
  upsert     Insert or replace a row by key
  update     Set columns on rows matching --where-json
  delete     Delete rows matching --where-json
  validate   Check required / unique columns
  sort       Sort body rows by a column
  dedupe     Keep first row for each key value

Global options:
  --json                 JSON envelope on stdout
  --follow-symlinks      Allow FILE to be a symlink (default: refuse)
  --help, -h             Show help
  --version, -V          Show version

Mutation options (upsert, update, delete, sort, dedupe):
  --write                Apply the change (default: print a unified diff only)
  --if-hash HASH         Refuse (exit 5) if the table sha256 is not HASH

Safety:
  Without --write the file is never modified.
  Bytes outside the selected table range are never changed.
  Ambiguous --table matches are refused (exit 4), never first-match.

Exit codes:
  0 success
  1 other error
  2 usage
  3 table not found
  4 ambiguous table selection
  5 --if-hash mismatch
  6 validation failed
  7 symlink refused

See also: mdtableops <command> --help
`;

export function commandHelp(cmd: CommandName): string {
  switch (cmd) {
    case "list":
      return `mdtableops list FILE [--json]

List every GFM table. Fields: id, heading path, 1-based document and
heading-local index, startLine, endLine, columns, rowCount, sha256 of the
exact table source bytes (as stored on disk, including newlines).

Table IDs are slug(heading path) + "-" + occurrence under that path
(e.g. compatibility-1). IDs stay stable when surrounding prose changes
as long as the heading path and table order under that heading do not.
Tables before any heading use prefix "root".
`;
    case "read":
      return `mdtableops read FILE --table NAME | --table-id ID [--json]

Print one table. NAME matches heading path, last heading, heading slug,
or table id. Multiple matches → exit 4.
`;
    case "upsert":
      return `mdtableops upsert FILE --table|--table-id --key COL --row-json JSON [--write] [--if-hash HASH]

If a body row has COL equal to the value in JSON, merge JSON into that row.
Otherwise append a new row. Duplicate keys are refused. JSON must be an object.
`;
    case "update":
      return `mdtableops update FILE --table|--table-id --where-json JSON --set-json JSON [--write] [--if-hash HASH]

Update every body row that matches all columns in --where-json.
--where-json must contain at least one column.
`;
    case "delete":
      return `mdtableops delete FILE --table|--table-id --where-json JSON [--write] [--if-hash HASH]

Delete every body row that matches all columns in --where-json.
`;
    case "validate":
      return `mdtableops validate FILE --table|--table-id [--required a,b] [--unique a,b]

--required: listed columns exist and every body cell is non-empty.
--unique: the combination of listed columns is unique across body rows.
Fails with exit 6 if any error diagnostic is produced.
`;
    case "sort":
      return `mdtableops sort FILE --table|--table-id --by COL [--write] [--if-hash HASH]

Stable sort of body rows. Numeric if every value is empty or a number,
otherwise lexicographic.
`;
    case "dedupe":
      return `mdtableops dedupe FILE --table|--table-id --key COL [--write] [--if-hash HASH]

Keep the first body row for each value of COL; drop later duplicates.
`;
  }
}
