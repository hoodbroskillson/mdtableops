# CLI

Executable: `mdtableops`. Node 20+.

    mdtableops <command> FILE [options]

## Global flags

| Flag | Meaning |
| --- | --- |
| `--json` | JSON envelope on stdout (see JSON_SCHEMA.md) |
| `--follow-symlinks` | Allow FILE to be a symlink (writes the real path) |
| `--help`, `-h` | Help |
| `--version`, `-V` | Version |

## list

    mdtableops list FILE [--json]

Each table: `id`, `headingPath`, `documentIndex`, `headingIndex`, `startLine`, `endLine`, `columns`, `rowCount`, `sha256`.

`sha256` is hex of the **exact** table source bytes in the file, including that table’s newlines.

### Table id

`slug(heading1-heading2-...)-N`

- ATX headings only (`#`–`######`), stacked by level.
- Slug: lowercase, runs of non-alphanumerics → `-`, trimmed. No heading → `root`.
- `N` is 1-based among tables that share that slug, in document order.

Stable if prose/fences/HTML around the table change. Not stable if heading text or table order under that heading changes.

## read

    mdtableops read FILE --table NAME | --table-id ID [--json]

`--table` matches heading path (`A > B` or `A/B`), last heading, heading slug, or id. Multiple matches → exit 4.

## Mutations

All of these accept `--write` (apply) and `--if-hash HASH` (exit 5 if the current table hash differs). Without `--write`, stdout includes a unified diff of the table-range replacement only.

### upsert

    mdtableops upsert FILE --table|--table-id --key COL --row-json JSON [--write] [--if-hash HASH]

JSON object. If exactly one body row has `COL` equal to the JSON value for that column, merge JSON into the row. If none, append. If several, refuse.

### update

    mdtableops update FILE --table|--table-id --where-json JSON --set-json JSON [--write] [--if-hash HASH]

AND-match on `--where-json` (at least one column). Updates every matching body row.

### delete

    mdtableops delete FILE --table|--table-id --where-json JSON [--write] [--if-hash HASH]

### sort

    mdtableops sort FILE --table|--table-id --by COL [--write] [--if-hash HASH]

Stable. Numeric when every body value is empty or a decimal number; otherwise lexicographic.

### dedupe

    mdtableops dedupe FILE --table|--table-id --key COL [--write] [--if-hash HASH]

Keeps the first row for each key value.

## validate

    mdtableops validate FILE --table|--table-id [--required a,b] [--unique a,b]

`--required`: columns exist; every body cell non-empty after trim.
`--unique`: the **combination** of listed columns is unique across body rows.

Any error diagnostic → exit 6. Duplicate header names emit a warning but are not by themselves a failure.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | other error |
| 2 | usage |
| 3 | table not found |
| 4 | ambiguous selection |
| 5 | hash mismatch |
| 6 | validation failed |
| 7 | symlink refused |

## Newlines and atomic write

The rewritten table uses the FILE’s first newline convention (CRLF, LF, or CR). Bytes outside `[startOffset, endOffset)` are copied unchanged.

Replace is: write `.<name>.mdtableops-<pid>-<rand>.tmp` in the same directory, then `rename`. On Windows, if replace fails, rename the destination to a sibling `.bak`, retry, and restore the `.bak` if the second rename fails. Unlink `.bak` only on success.
