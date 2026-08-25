export type Alignment = "left" | "right" | "center" | "none";

export interface TableRow {
  /** Trimmed, unescaped cell values aligned to header column count. */
  values: string[];
}

export interface MarkdownTable {
  id: string;
  headingPath: string[];
  documentIndex: number;
  headingIndex: number;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  columns: string[];
  alignments: Alignment[];
  rows: TableRow[];
  outerPipes: boolean;
  /** Exact table source bytes as they appear in the file, including newlines. */
  source: Buffer;
  sha256: string;
  newline: Buffer;
}

export interface ParsedDocument {
  filePath: string;
  bytes: Buffer;
  newline: Buffer;
  tables: MarkdownTable[];
}

export interface TableListItem {
  id: string;
  headingPath: string[];
  documentIndex: number;
  headingIndex: number;
  startLine: number;
  endLine: number;
  columns: string[];
  rowCount: number;
  sha256: string;
}

export interface Diagnostic {
  level: "info" | "warn" | "error";
  message: string;
  file?: string;
  table?: string;
  column?: string;
  line?: number;
}

export interface Envelope<T> {
  schemaVersion: number;
  ok: boolean;
  changed: boolean;
  data: T;
  diagnostics: Diagnostic[];
}

export interface RowObject {
  [column: string]: string;
}
