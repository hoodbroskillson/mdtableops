import { EXIT } from "./codes.js";
import { AppError } from "./errors.js";
import type { MarkdownTable, ParsedDocument } from "./types.js";

function headingJoin(path: string[], sep: string): string {
  return path.join(sep);
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Resolve a single table. `--table-id` matches the stable id exactly (case-insensitive).
 * `--table` matches heading path, last heading, heading slug, or the table id.
 * Multiple matches → exit 4. Zero matches → exit 3.
 */
export function selectTable(
  doc: ParsedDocument,
  opts: { table?: string; tableId?: string },
): MarkdownTable {
  const file = doc.filePath;
  if (!opts.table && !opts.tableId) {
    throw new AppError("select a table with --table NAME or --table-id ID", EXIT.usage, { file });
  }
  if (opts.tableId) {
    const want = norm(opts.tableId);
    const hits = doc.tables.filter((t) => norm(t.id) === want);
    if (hits.length === 0) {
      throw new AppError(`table not found: ${opts.tableId}`, EXIT.missingTable, {
        file,
        table: opts.tableId,
      });
    }
    if (hits.length > 1) {
      throw new AppError(
        `ambiguous table id ${opts.tableId}: matches ${hits.map((t) => t.id).join(", ")}`,
        EXIT.ambiguous,
        { file, table: opts.tableId },
      );
    }
    const byId = hits[0]!;
    if (opts.table) {
      const byName = matchByName(doc, opts.table);
      if (!byName.some((t) => t.id === byId.id)) {
        throw new AppError(
          `--table ${opts.table} does not match --table-id ${opts.tableId}`,
          EXIT.usage,
          { file, table: opts.tableId },
        );
      }
    }
    return byId;
  }
  const hits = matchByName(doc, opts.table ?? "");
  if (hits.length === 0) {
    throw new AppError(`table not found: ${opts.table}`, EXIT.missingTable, {
      file,
      table: opts.table,
    });
  }
  if (hits.length > 1) {
    throw new AppError(
      `ambiguous table ${opts.table}: matches ${hits.map((t) => `${t.id} (lines ${t.startLine}-${t.endLine})`).join("; ")}`,
      EXIT.ambiguous,
      { file, table: opts.table },
    );
  }
  return hits[0]!;
}

function matchByName(doc: ParsedDocument, name: string): MarkdownTable[] {
  const want = norm(name);
  if (!want) return [];
  const hits: MarkdownTable[] = [];
  const seen = new Set<string>();
  const add = (t: MarkdownTable) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    hits.push(t);
  };
  for (const t of doc.tables) {
    if (norm(t.id) === want) add(t);
    const gt = headingJoin(t.headingPath, " > ");
    const slash = headingJoin(t.headingPath, "/");
    const last = t.headingPath[t.headingPath.length - 1] ?? "";
    const slugPath = t.headingPath.length
      ? t.headingPath.map((p) => p.toLowerCase()).join("-")
      : "root";
    if (norm(gt) === want || norm(slash) === want || norm(last) === want) add(t);
    if (norm(slugPath) === want) add(t);
  }
  return hits;
}

export function findColumn(columns: string[], name: string, details: { file?: string; table?: string }): number {
  const exact = columns.findIndex((c) => c === name);
  if (exact >= 0) return exact;
  const lower = name.toLowerCase();
  const ci = columns
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.toLowerCase() === lower);
  if (ci.length === 1) return ci[0]!.i;
  if (ci.length > 1) {
    throw new AppError(`ambiguous column ${name}`, EXIT.error, { ...details, column: name });
  }
  throw new AppError(`column not found: ${name}`, EXIT.error, { ...details, column: name });
}
