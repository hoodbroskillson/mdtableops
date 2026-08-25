/**
 * Unified diff of a table-range replacement. Surrounding document bytes are not shown.
 */
export function unifiedDiff(opts: {
  filePath: string;
  startLine: number;
  oldText: string;
  newText: string;
}): string {
  const oldLines = splitKeep(opts.oldText);
  const newLines = splitKeep(opts.newText);
  const start = opts.startLine;
  const header = `--- a/${opts.filePath}\n+++ b/${opts.filePath}\n`;
  const hunk = `@@ -${start},${oldLines.length} +${start},${newLines.length} @@\n`;
  const body =
    oldLines.map((l) => `-${l}`).join("\n") +
    (oldLines.length ? "\n" : "") +
    newLines.map((l) => `+${l}`).join("\n") +
    (newLines.length ? "\n" : "");
  return header + hunk + body;
}

function splitKeep(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split(/\r\n|\n|\r/);
  if (text.match(/\r\n|\n|\r$/)) {
    if (parts[parts.length - 1] === "") parts.pop();
  }
  return parts;
}
