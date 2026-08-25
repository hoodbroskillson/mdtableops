# Changelog

## Unreleased

- Windows `atomicWriteFile` no longer unlinks the destination before a replace that can still fail. Dest is copied to a sibling `.bak` first and restored if the retry fails. The error message claims the original is unchanged only when dest still exists with the original bytes.

### 1.0.0

- `list`, `read`, `upsert`, `update`, `delete`, `validate`, `sort`, `dedupe`
- GFM table lexer (fences, HTML comments, escaped pipes, inline code pipes, CRLF)
- Stable table ids from heading path + occurrence
- Dry-run unified diffs; `--write`; `--if-hash`; atomic replace
- JSON envelope `schemaVersion` 1
- Exit codes 0, 1, 2, 3, 4, 5, 6, 7

This version is unreleased until a git tag is cut.
