import type { Alignment, MarkdownTable } from "./types.js";

export function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function displayWidth(s: string): number {
  return [...s].length;
}

function dashCount(align: Alignment, width: number): { left: string; dashes: number; right: string } {
  const left = align === "left" || align === "center" ? ":" : "";
  const right = align === "right" || align === "center" ? ":" : "";
  const dashes = Math.max(3, width - left.length - right.length);
  return { left, dashes, right };
}

function renderRow(cells: string[], widths: number[], outer: boolean): string {
  const inner = cells
    .map((c, i) => {
      const w = widths[i] ?? 0;
      const pad = w - displayWidth(c);
      return ` ${c}${" ".repeat(Math.max(0, pad))} `;
    })
    .join("|");
  return outer ? `|${inner}|` : inner;
}

function renderDelim(alignments: Alignment[], widths: number[], outer: boolean): string {
  const inner = alignments
    .map((a, i) => {
      const w = widths[i] ?? 3;
      const { left, dashes, right } = dashCount(a, w);
      const body = `${left}${ "-".repeat(dashes) }${right}`;
      const pad = Math.max(0, w - displayWidth(body));
      return ` ${body}${" ".repeat(pad)} `;
    })
    .join("|");
  return outer ? `|${inner}|` : inner;
}

export function formatTable(table: Pick<MarkdownTable, "columns" | "alignments" | "rows" | "outerPipes">): string[] {
  const colCount = table.columns.length;
  const escapedHeader = table.columns.map(escapeCell);
  const escapedRows = table.rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => escapeCell(r.values[i] ?? "")),
  );
  const widths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    let w = displayWidth(escapedHeader[i] ?? "");
    const align = table.alignments[i] ?? "none";
    const d = dashCount(align, 3);
    w = Math.max(w, displayWidth(d.left + "-".repeat(d.dashes) + d.right));
    for (const row of escapedRows) {
      w = Math.max(w, displayWidth(row[i] ?? ""));
    }
    widths.push(w);
  }
  const lines = [renderRow(escapedHeader, widths, table.outerPipes), renderDelim(table.alignments, widths, table.outerPipes)];
  for (const row of escapedRows) {
    lines.push(renderRow(row, widths, table.outerPipes));
  }
  return lines;
}

export function serializeTable(table: MarkdownTable, newline: Buffer): Buffer {
  const lines = formatTable(table);
  const nl = newline.length ? newline : Buffer.from("\n");
  const parts: Buffer[] = [];
  for (let i = 0; i < lines.length; i++) {
    parts.push(Buffer.from(lines[i] ?? "", "utf8"));
    const isLast = i === lines.length - 1;
    if (!isLast) {
      parts.push(nl);
    } else if (table.source.length && (table.source[table.source.length - 1] === 0x0a || table.source[table.source.length - 1] === 0x0d)) {
      parts.push(nl);
    }
  }
  return Buffer.concat(parts);
}

