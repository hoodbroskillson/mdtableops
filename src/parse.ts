import { sha256 } from "./hash.js";
import { detectNewline } from "./io.js";
import type { Alignment, MarkdownTable, ParsedDocument, TableRow } from "./types.js";

export interface Line {
  number: number;
  text: string;
  start: number;
  end: number;
  newline: Buffer;
}

const DELIM_CELL = /^:?-{3,}:?$/;

export function splitLines(bytes: Buffer): Line[] {
  const lines: Line[] = [];
  let i = 0;
  let lineNo = 1;
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
    i = 3;
  }
  while (i < bytes.length) {
    if (bytes[i] === 0x0d && i + 1 < bytes.length && bytes[i + 1] === 0x0a) {
      lines.push({
        number: lineNo,
        text: bytes.subarray(start, i).toString("utf8"),
        start,
        end: i + 2,
        newline: Buffer.from("\r\n"),
      });
      i += 2;
      start = i;
      lineNo++;
    } else if (bytes[i] === 0x0a) {
      lines.push({
        number: lineNo,
        text: bytes.subarray(start, i).toString("utf8"),
        start,
        end: i + 1,
        newline: Buffer.from("\n"),
      });
      i += 1;
      start = i;
      lineNo++;
    } else if (bytes[i] === 0x0d) {
      lines.push({
        number: lineNo,
        text: bytes.subarray(start, i).toString("utf8"),
        start,
        end: i + 1,
        newline: Buffer.from("\r"),
      });
      i += 1;
      start = i;
      lineNo++;
    } else {
      i++;
    }
  }
  if (start < bytes.length) {
    lines.push({
      number: lineNo,
      text: bytes.subarray(start).toString("utf8"),
      start,
      end: bytes.length,
      newline: Buffer.alloc(0),
    });
  }
  return lines;
}

interface OpenFence {
  char: "`" | "~";
  len: number;
}

export function openingFence(text: string): OpenFence | null {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
  if (!m) return null;
  const seq = m[2] ?? "";
  const char = seq[0] as "`" | "~";
  const rest = m[3] ?? "";
  if (char === "`" && rest.includes("`")) return null;
  return { char, len: seq.length };
}

export function isClosingFence(text: string, open: OpenFence): boolean {
  const m = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(text);
  if (!m) return false;
  const seq = m[2] ?? "";
  if (seq[0] !== open.char) return false;
  return seq.length >= open.len;
}

export function parseAtxHeading(text: string): { level: number; text: string } | null {
  const m = /^( {0,3})(#{1,6})($|[ \t]+(.*))$/.exec(text);
  if (!m) return null;
  const level = (m[2] ?? "").length;
  let content = (m[4] ?? "").trim();
  content = content.replace(/[ \t]+#+$/, "").trim();
  return { level, text: content };
}

function isBlank(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

function isBlockquote(text: string): boolean {
  return /^ {0,3}>/.test(text);
}

function isThematicBreak(text: string): boolean {
  return /^ {0,3}((?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text);
}

function isListMarker(text: string): boolean {
  return /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/.test(text);
}

function isHtmlCommentOpen(text: string): boolean {
  return /^ {0,3}<!--/.test(text);
}

function htmlCommentCloses(text: string): boolean {
  return text.includes("-->");
}

/**
 * Split a GFM table row into raw (untrimmed) cells.
 * Unescaped `|` outside inline code spans are column separators.
 * Escaped `\|` is never a separator. Pipes inside `code` are not columns
 * (agent-friendly extension; GFM itself still requires \| inside spans).
 */
export function splitTableRow(line: string): { cells: string[]; outerPipes: boolean } | null {
  const indent = /^ {0,3}/.exec(line)?.[0].length ?? 0;
  const s = line.slice(indent);
  if (!s.includes("|")) return null;
  const cells: string[] = [];
  let buf = "";
  let i = 0;
  let codeN = 0;
  let sawSeparator = false;
  while (i < s.length) {
    const ch = s[i] ?? "";
    if (codeN === 0 && ch === "\\" && s[i + 1] === "|") {
      buf += "\\|";
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 0;
      while (s[i + n] === "`") n++;
      if (codeN === 0) {
        codeN = n;
      } else if (n === codeN) {
        codeN = 0;
      }
      buf += "`".repeat(n);
      i += n;
      continue;
    }
    if (ch === "|" && codeN === 0) {
      cells.push(buf);
      buf = "";
      sawSeparator = true;
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  cells.push(buf);
  if (!sawSeparator) return null;

  const leadPipe = s.trimStart().startsWith("|");
  const trailPipe = (() => {
    // last separator was at end of string (possibly with trailing spaces already in last cell)
    // Standard: if the last cell is empty because the line ended with a separator pipe.
    let j = s.length - 1;
    while (j >= 0 && (s[j] === " " || s[j] === "\t")) j--;
    if (j < 0) return false;
    if (s[j] !== "|") return false;
    // escaped?
    let bs = 0;
    let k = j - 1;
    while (k >= 0 && s[k] === "\\") {
      bs++;
      k--;
    }
    if (bs % 2 === 1) return false;
    return true;
  })();

  if (leadPipe && cells.length) cells.shift();
  if (trailPipe && cells.length) cells.pop();
  if (cells.length === 0) return null;
  return { cells, outerPipes: leadPipe || trailPipe };
}

export function unescapeCell(raw: string): string {
  return raw.trim().replace(/\\\|/g, "|");
}

export function parseDelimiter(line: string): Alignment[] | null {
  const split = splitTableRow(line);
  if (!split) return null;
  const alignments: Alignment[] = [];
  for (const cell of split.cells) {
    const t = cell.trim().replace(/\s+/g, "");
    if (!DELIM_CELL.test(t)) return null;
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) alignments.push("center");
    else if (right) alignments.push("right");
    else if (left) alignments.push("left");
    else alignments.push("none");
  }
  return alignments.length ? alignments : null;
}

export function slug(text: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s;
}

export function headingSlug(path: string[]): string {
  const parts = path.map(slug).filter((p) => p.length > 0);
  return parts.length ? parts.join("-") : "root";
}

function padRow(values: string[], n: number): string[] {
  const out = values.slice(0, n);
  while (out.length < n) out.push("");
  return out;
}

function looksLikeBlockStart(text: string): boolean {
  if (isBlank(text)) return true;
  if (parseAtxHeading(text)) return true;
  if (openingFence(text)) return true;
  if (isBlockquote(text)) return true;
  if (isHtmlCommentOpen(text)) return true;
  if (isThematicBreak(text)) return true;
  if (isListMarker(text)) return true;
  return false;
}

export function parseMarkdown(bytes: Buffer, filePath = ""): ParsedDocument {
  const lines = splitLines(bytes);
  const newline = detectNewline(bytes);
  const tables: MarkdownTable[] = [];
  const headingStack: { level: number; text: string }[] = [];
  const occ = new Map<string, number>();
  let documentIndex = 0;

  let fence: OpenFence | null = null;
  let inHtmlComment = false;

  const headingPath = (): string[] => headingStack.map((h) => h.text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (inHtmlComment) {
      if (htmlCommentCloses(line.text)) inHtmlComment = false;
      continue;
    }
    if (fence) {
      if (isClosingFence(line.text, fence)) fence = null;
      continue;
    }

    const open = openingFence(line.text);
    if (open) {
      fence = open;
      continue;
    }
    if (isHtmlCommentOpen(line.text)) {
      if (!htmlCommentCloses(line.text)) inHtmlComment = true;
      continue;
    }

    const heading = parseAtxHeading(line.text);
    if (heading) {
      while (headingStack.length && (headingStack[headingStack.length - 1]?.level ?? 0) >= heading.level) {
        headingStack.pop();
      }
      headingStack.push(heading);
      continue;
    }

    const headerSplit = splitTableRow(line.text);
    const delimLine = lines[i + 1];
    const alignments = delimLine ? parseDelimiter(delimLine.text) : null;
    if (!headerSplit || !alignments) continue;
    if (headerSplit.cells.length !== alignments.length) continue;

    const columns = headerSplit.cells.map(unescapeCell);
    const rows: TableRow[] = [];
    let last = i + 1;
    let j = i + 2;
    while (j < lines.length) {
      const body = lines[j];
      if (!body) break;
      if (looksLikeBlockStart(body.text) && !splitTableRow(body.text)) break;
      if (isBlank(body.text)) break;
      if (openingFence(body.text)) break;
      if (parseAtxHeading(body.text)) break;
      if (isBlockquote(body.text)) break;
      if (isHtmlCommentOpen(body.text)) break;
      const split = splitTableRow(body.text);
      const values = split
        ? padRow(split.cells.map(unescapeCell), columns.length)
        : padRow([unescapeCell(body.text)], columns.length);
      rows.push({ values });
      last = j;
      j++;
    }

    const startLine = lines[i]!;
    const endLine = lines[last]!;
    const source = Buffer.from(bytes.subarray(startLine.start, endLine.end));
    documentIndex += 1;
    const path = headingPath();
    const base = headingSlug(path);
    const n = (occ.get(base) ?? 0) + 1;
    occ.set(base, n);
    const table: MarkdownTable = {
      id: `${base}-${n}`,
      headingPath: path,
      documentIndex,
      headingIndex: n,
      startLine: startLine.number,
      endLine: endLine.number,
      startOffset: startLine.start,
      endOffset: endLine.end,
      columns,
      alignments,
      rows,
      outerPipes: headerSplit.outerPipes,
      source,
      sha256: sha256(source),
      newline: endLine.newline.length ? endLine.newline : newline,
    };
    tables.push(table);
    i = last;
  }

  return { filePath, bytes, newline, tables };
}

export function toListItem(t: MarkdownTable) {
  return {
    id: t.id,
    headingPath: t.headingPath,
    documentIndex: t.documentIndex,
    headingIndex: t.headingIndex,
    startLine: t.startLine,
    endLine: t.endLine,
    columns: t.columns,
    rowCount: t.rows.length,
    sha256: t.sha256,
  };
}
