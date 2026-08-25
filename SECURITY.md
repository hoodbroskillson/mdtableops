# Security

mdtableops is a local CLI. It does not open network sockets, read API keys, or execute Markdown.

## Reporting

Please use GitHub private vulnerability reporting on this repository:

https://github.com/hoodbroskillson/mdtableops/security/advisories/new

## Scope notes

- FILE is read as bytes and parsed as GFM tables. Do not point it at files you do not intend to parse.
- `--write` replaces the target file via a same-directory temp + rename. Callers must pass `--if-hash` if they need optimistic concurrency.
- Symlinks are refused unless `--follow-symlinks`. Following a symlink writes the resolved path, not the symlink inode.
- JSON flags are parsed as data, not code.
