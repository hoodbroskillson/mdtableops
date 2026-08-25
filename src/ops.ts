import { EXIT } from "./codes.js";
import { unifiedDiff } from "./diff.js";
import { AppError } from "./errors.js";
import { serializeTable } from "./format.js";
import { sha256 } from "./hash.js";
import { atomicWriteFile } from "./io.js";
import { parseMarkdown, toListItem } from "./parse.js";
import { findColumn, selectTable } from "./select.js";
import type {
  Diagnostic,
  MarkdownTable,
  ParsedDocument,
  RowObject,
  TableListItem,
  TableRow,
} from "./types.js";

export interface MutateResult {
  changed: boolean;
  diff: string;
  hashBefore: string;
  hashAfter: string;
  tableId: string;
  wrote: boolean;
  rowsAffected: number;
  bytes: Buffer;
}

export function rowsToObjects(table: MarkdownTable): RowObject[] {
  return table.rows.map((r) => {
    const obj: RowObject = {};
    for (let i = 0; i < table.columns.length; i++) {
      const col = table.columns[i] ?? `col${i + 1}`;
      if (obj[col] === undefined) obj[col] = r.values[i] ?? "";
    }
    return obj;
  });
}

export function parseJsonObject(raw: string, flag: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (err) {
    throw new AppError(`invalid ${flag}: ${(err as Error).message}`, EXIT.usage);
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new AppError(`${flag} must be a JSON object`, EXIT.usage);
  }
  return v as Record<string, unknown>;
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function jsonToRowPatch(
  table: MarkdownTable,
  obj: Record<string, unknown>,
  file: string,
): { index: number; value: string }[] {
  const patch: { index: number; value: string }[] = [];
  for (const key of Object.keys(obj)) {
    const idx = findColumn(table.columns, key, { file, table: table.id });
    patch.push({ index: idx, value: stringifyValue(obj[key]) });
  }
  return patch;
}

function rowMatches(
  row: TableRow,
  where: { index: number; value: string }[],
): boolean {
  return where.every((w) => (row.values[w.index] ?? "") === w.value);
}

function applyPatch(row: TableRow, patch: { index: number; value: string }[]): TableRow {
  const values = row.values.slice();
  for (const p of patch) values[p.index] = p.value;
  return { values };
}

function emptyRow(n: number): TableRow {
  return { values: Array.from({ length: n }, () => "") };
}

function spliceTable(doc: ParsedDocument, table: MarkdownTable, next: MarkdownTable): Buffer {
  const rendered = serializeTable(next, doc.newline);
  return Buffer.concat([
    doc.bytes.subarray(0, table.startOffset),
    rendered,
    doc.bytes.subarray(table.endOffset),
  ]);
}

function checkHash(table: MarkdownTable, ifHash: string | undefined, file: string): void {
  if (!ifHash) return;
  if (table.sha256 !== ifHash) {
    throw new AppError(
      `table hash mismatch: expected ${ifHash}, actual ${table.sha256}`,
      EXIT.hashMismatch,
      { file, table: table.id, line: table.startLine },
    );
  }
}

function finishMutate(
  doc: ParsedDocument,
  table: MarkdownTable,
  nextTable: MarkdownTable,
  rowsAffected: number,
): MutateResult {
  const rendered = serializeTable(nextTable, doc.newline);
  const changed = !table.source.equals(rendered);
  const bytes = changed ? spliceTable(doc, table, nextTable) : doc.bytes;
  const diff = unifiedDiff({
    filePath: doc.filePath,
    startLine: table.startLine,
    oldText: table.source.toString("utf8"),
    newText: rendered.toString("utf8"),
  });
  return {
    changed,
    diff,
    hashBefore: table.sha256,
    hashAfter: sha256(rendered),
    tableId: table.id,
    wrote: false,
    rowsAffected,
    bytes,
  };
}

export async function maybeWrite(
  filePath: string,
  result: MutateResult,
  write: boolean,
): Promise<MutateResult> {
  if (!write || !result.changed) return { ...result, wrote: false };
  await atomicWriteFile(filePath, result.bytes);
  return { ...result, wrote: true };
}

export function listTables(doc: ParsedDocument): TableListItem[] {
  return doc.tables.map(toListItem);
}

export function readTableData(doc: ParsedDocument, sel: { table?: string; tableId?: string }) {
  const table = selectTable(doc, sel);
  return {
    id: table.id,
    headingPath: table.headingPath,
    documentIndex: table.documentIndex,
    headingIndex: table.headingIndex,
    startLine: table.startLine,
    endLine: table.endLine,
    columns: table.columns,
    alignments: table.alignments,
    rows: rowsToObjects(table),
    rowCount: table.rows.length,
    sha256: table.sha256,
  };
}

export function upsert(
  doc: ParsedDocument,
  sel: { table?: string; tableId?: string },
  keyCol: string,
  rowJson: Record<string, unknown>,
  ifHash?: string,
): MutateResult {
  const table = selectTable(doc, sel);
  checkHash(table, ifHash, doc.filePath);
  const keyIdx = findColumn(table.columns, keyCol, { file: doc.filePath, table: table.id });
  const patch = jsonToRowPatch(table, rowJson, doc.filePath);
  const keyPatch = patch.find((p) => p.index === keyIdx);
  if (!keyPatch) {
    throw new AppError(`--row-json must include key column ${keyCol}`, EXIT.usage, {
      file: doc.filePath,
      table: table.id,
      column: keyCol,
    });
  }
  const keyValue = keyPatch.value;
  const matches: number[] = [];
  table.rows.forEach((r, i) => {
    if ((r.values[keyIdx] ?? "") === keyValue) matches.push(i);
  });
  if (matches.length > 1) {
    throw new AppError(
      `duplicate key ${keyCol}=${JSON.stringify(keyValue)} in ${matches.length} rows`,
      EXIT.error,
      { file: doc.filePath, table: table.id, column: keyCol },
    );
  }
  let rows: TableRow[];
  let affected = 1;
  if (matches.length === 1) {
    const i = matches[0]!;
    rows = table.rows.slice();
    rows[i] = applyPatch(rows[i]!, patch);
  } else {
    const row = applyPatch(emptyRow(table.columns.length), patch);
    rows = [...table.rows, row];
  }
  return finishMutate(doc, table, { ...table, rows }, affected);
}

export function updateRows(
  doc: ParsedDocument,
  sel: { table?: string; tableId?: string },
  whereJson: Record<string, unknown>,
  setJson: Record<string, unknown>,
  ifHash?: string,
): MutateResult {
  const table = selectTable(doc, sel);
  checkHash(table, ifHash, doc.filePath);
  const whereKeys = Object.keys(whereJson);
  if (whereKeys.length === 0) {
    throw new AppError("--where-json must include at least one column", EXIT.usage, {
      file: doc.filePath,
      table: table.id,
    });
  }
  const setKeys = Object.keys(setJson);
  if (setKeys.length === 0) {
    throw new AppError("--set-json must include at least one column", EXIT.usage, {
      file: doc.filePath,
      table: table.id,
    });
  }
  const where = jsonToRowPatch(table, whereJson, doc.filePath);
  const patch = jsonToRowPatch(table, setJson, doc.filePath);
  let affected = 0;
  const rows = table.rows.map((r) => {
    if (!rowMatches(r, where)) return r;
    affected++;
    return applyPatch(r, patch);
  });
  return finishMutate(doc, table, { ...table, rows }, affected);
}

export function deleteRows(
  doc: ParsedDocument,
  sel: { table?: string; tableId?: string },
  whereJson: Record<string, unknown>,
  ifHash?: string,
): MutateResult {
  const table = selectTable(doc, sel);
  checkHash(table, ifHash, doc.filePath);
  if (Object.keys(whereJson).length === 0) {
    throw new AppError("--where-json must include at least one column", EXIT.usage, {
      file: doc.filePath,
      table: table.id,
    });
  }
  const where = jsonToRowPatch(table, whereJson, doc.filePath);
  const kept: TableRow[] = [];
  let affected = 0;
  for (const r of table.rows) {
    if (rowMatches(r, where)) affected++;
    else kept.push(r);
  }
  return finishMutate(doc, table, { ...table, rows: kept }, affected);
}

export function sortRows(
  doc: ParsedDocument,
  sel: { table?: string; tableId?: string },
  by: string,
  ifHash?: string,
): MutateResult {
  const table = selectTable(doc, sel);
  checkHash(table, ifHash, doc.filePath);
  const idx = findColumn(table.columns, by, { file: doc.filePath, table: table.id });
  const values = table.rows.map((r) => r.values[idx] ?? "");
  const numeric = values.every((v) => v === "" || /^-?\d+(\.\d+)?$/.test(v));
  const indexed = table.rows.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    const av = a.r.values[idx] ?? "";
    const bv = b.r.values[idx] ?? "";
    let cmp = 0;
    if (numeric) {
      const na = av === "" ? Number.NEGATIVE_INFINITY : Number(av);
      const nb = bv === "" ? Number.NEGATIVE_INFINITY : Number(bv);
      cmp = na - nb;
    } else {
      cmp = av < bv ? -1 : av > bv ? 1 : 0;
    }
    return cmp !== 0 ? cmp : a.i - b.i;
  });
  const rows = indexed.map((x) => x.r);
  return finishMutate(doc, table, { ...table, rows }, table.rows.length);
}

export function dedupeRows(
  doc: ParsedDocument,
  sel: { table?: string; tableId?: string },
  keyCol: string,
  ifHash?: string,
): MutateResult {
  const table = selectTable(doc, sel);
  checkHash(table, ifHash, doc.filePath);
  const idx = findColumn(table.columns, keyCol, { file: doc.filePath, table: table.id });
  const seen = new Set<string>();
  const kept: TableRow[] = [];
  let affected = 0;
  for (const r of table.rows) {
    const k = r.values[idx] ?? "";
    if (seen.has(k)) {
      affected++;
      continue;
    }
    seen.add(k);
    kept.push(r);
  }
  return finishMutate(doc, table, { ...table, rows: kept }, affected);
}

export interface ValidateResult {
  ok: boolean;
  tableId: string;
  diagnostics: Diagnostic[];
}

export function validateTable(
  doc: ParsedDocument,
  sel: { table?: string; tableId?: string },
  required: string[],
  unique: string[],
): ValidateResult {
  const table = selectTable(doc, sel);
  const diags: Diagnostic[] = [];
  const file = doc.filePath;
  const reqIdx = required.map((c) => ({
    name: c,
    index: findColumn(table.columns, c, { file, table: table.id }),
  }));
  const uniqIdx = unique.map((c) => ({
    name: c,
    index: findColumn(table.columns, c, { file, table: table.id }),
  }));
  const dupCols = table.columns.filter((c, i) => table.columns.indexOf(c) !== i);
  if (dupCols.length) {
    diags.push({
      level: "warn",
      message: `duplicate header names: ${[...new Set(dupCols)].join(", ")}`,
      file,
      table: table.id,
      line: table.startLine,
    });
  }
  for (const col of reqIdx) {
    table.rows.forEach((r, ri) => {
      const v = (r.values[col.index] ?? "").trim();
      if (!v) {
        diags.push({
          level: "error",
          message: `required column ${col.name} is empty in row ${ri + 1}`,
          file,
          table: table.id,
          column: col.name,
          line: table.startLine + 2 + ri,
        });
      }
    });
  }
  if (uniqIdx.length) {
    const seen = new Map<string, number>();
    table.rows.forEach((r, ri) => {
      const key = uniqIdx.map((c) => r.values[c.index] ?? "").join("\0");
      const prev = seen.get(key);
      if (prev !== undefined) {
        diags.push({
          level: "error",
          message: `unique constraint (${unique.join(", ")}) duplicated in rows ${prev + 1} and ${ri + 1}`,
          file,
          table: table.id,
          line: table.startLine + 2 + ri,
        });
      } else {
        seen.set(key, ri);
      }
    });
  }
  const ok = !diags.some((d) => d.level === "error");
  return { ok, tableId: table.id, diagnostics: diags };
}

export { parseMarkdown };
