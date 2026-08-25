# JSON envelope

`--json` prints one object plus a trailing newline.

    {
      "schemaVersion": 1,
      "ok": true,
      "changed": false,
      "data": {},
      "diagnostics": []
    }

| Field | Type | Notes |
| --- | --- | --- |
| schemaVersion | number | Always `1` |
| ok | boolean | False on errors (exit code still set) |
| changed | boolean | True if table bytes would differ / did differ |
| data | object | Command payload |
| diagnostics | array | `{ level, message, file?, table?, column?, line? }` |

`level` is `info` | `warn` | `error`.

## list

`data.file`, `data.tables` (see CLI.md list fields).

## read

`data` includes `id`, `headingPath`, `documentIndex`, `headingIndex`, `startLine`, `endLine`, `columns`, `alignments`, `rows` (objects keyed by column name; first header wins on duplicates), `rowCount`, `sha256`.

## mutations

`data.tableId`, `data.wrote`, `data.rowsAffected`, `data.hashBefore`, `data.hashAfter`, `data.diff`.

## validate

`ok` reflects validation. `data.tableId`. Failures are `diagnostics` with `level: "error"`.
