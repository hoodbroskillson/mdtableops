# AGENTS.md

How to use mdtableops from another agent. This is a CLI, not an MCP server and not a chat app.

## Workflow

1. List tables with `--json`. Copy `id` and `sha256`.
2. Read one table by `--table-id`.
3. Mutate without `--write` first. Confirm the unified diff only touches the intended table.
4. Re-list if needed. Pass `--if-hash` with the sha256 from step 1.
5. Repeat the mutation with `--write` and `--if-hash`.

Never guess when `list` shows two tables under the same heading. Use `--table-id`. Exit 4 means the name was ambiguous; do not retry the same `--table` name.

## Selection

- Prefer `--table-id compatibility-1` over `--table Compatibility`.
- Table ids stay stable when prose around the table changes, not when heading order or table order under that heading changes.
- `--table` matching more than one table fails closed (exit 4). There is no first-match.

## Writes

- No `--write` means the file is never modified.
- `--if-hash` mismatch means exit 5, no write.
- Only the selected table's exact byte range is replaced.
- FILE newline convention (CRLF vs LF) is preserved.
- Symlink FILE is refused unless `--follow-symlinks`.

## JSON

`--json` always prints one envelope with schemaVersion 1, ok, changed, data, and diagnostics.

On errors with `--json`, ok is false and the process still uses the exit codes below. See docs/JSON_SCHEMA.md.

## Exit codes

0 success, 1 other error, 2 usage, 3 missing table, 4 ambiguous, 5 hash mismatch, 6 validation, 7 symlink.

## Do not

- Do not send the file to a network API.
- Do not format the whole document.
- Do not parse tables out of fenced code; mdtableops already skips fences.
