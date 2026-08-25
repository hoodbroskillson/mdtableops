# mdtableops

**Safe CRUD operations for Markdown tables, built for AI agents.**

mdtableops edits GitHub-Flavored Markdown tables in existing files. It is not a Markdown editor, formatter, database, TUI, or LLM app. No MCP. No network. No API keys.

Copyright 2026 hoodbroskillson. MIT.

## Why

Agents need to change one row of a table inside a README or design doc without rewriting the rest of the file. mdtableops:

- Selects a table by stable id or heading (refuses ambiguous matches)
- Prints a unified diff unless you pass `--write`
- Optionally requires `--if-hash` so a stale selection cannot clobber a table that moved
- Replaces **only** the exact byte range of that table
- Preserves LF vs CRLF, headings, prose, fences, HTML, and frontmatter

## Install

Node 20+. Package name: `mdtableops`. After publish, `npx mdtableops` works. From a clone, install dependencies, run tests, build, then invoke the `mdtableops` binary (`package.json` `bin` points at `dist/cli.js`).

## Before / after

An agent updates one row. Surrounding document bytes stay identical.

**Before** (`examples/compatibility.md`):

    # Compatibility

    | Name | Status |
    | ---- | ------ |
    | parser | ok |
    | windows | stale |

Command (dry-run unless `--write`):

    mdtableops upsert examples/compatibility.md --table Compatibility --key Name --row-json '{"Name":"windows","Status":"ok"}'

**After** (only the selected table range is rewritten; heading and other rows remain; padding inside the table may be normalized):

    # Compatibility

    | Name    | Status |
    | ------- | ------ |
    | parser  | ok     |
    | windows | ok     |

Omit `--write` to print a unified diff of that table range. The file is not touched.

Pass `--if-hash HASH` from `list` so the write is refused (exit 5) if the table changed underfoot.

## Commands

- `list FILE` — list tables (id, heading, lines, columns, rowCount, sha256)
- `read FILE --table NAME | --table-id ID` — print one table
- `upsert FILE --key COL --row-json JSON` — insert or merge a row by key
- `update FILE --where-json JSON --set-json JSON` — set columns on matching rows
- `delete FILE --where-json JSON` — delete matching rows
- `validate FILE --required a,b --unique a,b` — required cells; unique is the column combination
- `sort FILE --by COL` — stable sort body rows
- `dedupe FILE --key COL` — keep first row per key

Mutations accept `--write` and `--if-hash HASH`. Global: `--json`, `--follow-symlinks`, `--help`, `--version`.

See docs/CLI.md and docs/JSON_SCHEMA.md.

## Table IDs

A table id is `slug(heading-path)-N`:

- Heading path is the stack of ATX headings (`#` through `######`) above the table.
- `slug` is lowercase; non-alphanumerics become `-`; empty path uses `root`.
- `N` is the 1-based index of tables that share that heading-path slug, in document order.

Examples: `compatibility-1`, `api-error-codes-1`, `root-1`.

The id stays the same if surrounding prose, fences, or HTML change, as long as the heading path and the order of tables under that path do not.

`--table NAME` matches a heading path (`Compatibility`, `API > Errors`), the last heading, the heading slug, or an id. If more than one table matches, mdtableops exits 4 instead of picking the first.

## Parser

GFM tables: optional outer pipes, alignment row, escaped `\|`, empty cells, Unicode, CRLF/LF, multiple tables under one heading, tables next to fences.

Pipes inside inline code spans are not treated as column separators (agent-friendly; GFM still documents `\|` even inside spans).

Tables inside fenced code (backticks or tildes, including info strings) are ignored. HTML comments are skipped.

## Safety and exit codes

- 0 success
- 1 other error (message includes file/table/column/line when known)
- 2 usage
- 3 table not found
- 4 ambiguous table selection
- 5 `--if-hash` mismatch (no write)
- 6 validation failed
- 7 FILE is a symlink and `--follow-symlinks` was not set

Writes are atomic: a temp file is created in the same directory, then renamed into place. On Windows, if that rename cannot replace the destination, the original is moved aside to a sibling `.bak` and restored if the swap fails. Default: refuse symlink files.

## Library

    import { parseMarkdown, upsert } from "mdtableops";

Zero runtime dependencies. TypeScript, ESM, Node 20+.

## License

MIT, copyright hoodbroskillson
