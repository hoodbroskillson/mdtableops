import { EXIT } from "./codes.js";
import { AppError, formatError } from "./errors.js";
import { errEnvelope, okEnvelope, printJson } from "./envelope.js";
import { readFileBytes } from "./io.js";
import {
  commandHelp,
  parseArgv,
  requireFile,
  requireTableSel,
  HELP_MAIN,
  type ParsedArgs,
} from "./argv.js";
import {
  dedupeRows,
  deleteRows,
  listTables,
  maybeWrite,
  parseJsonObject,
  parseMarkdown,
  readTableData,
  sortRows,
  updateRows,
  upsert,
  validateTable,
  type MutateResult,
} from "./ops.js";
import { VERSION } from "./version.js";

export interface Io {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function humanList(file: string, tables: ReturnType<typeof listTables>): string {
  if (tables.length === 0) return `no tables in ${file}\n`;
  return tables
    .map((t) => {
      const heading = t.headingPath.length ? t.headingPath.join(" > ") : "(root)";
      return [
        t.id,
        `heading=${JSON.stringify(heading)}`,
        `doc=#${t.documentIndex}`,
        `underHeading=#${t.headingIndex}`,
        `lines=${t.startLine}-${t.endLine}`,
        `columns=${t.columns.join(",")}`,
        `rows=${t.rowCount}`,
        `sha256=${t.sha256}`,
      ].join("\t");
    })
    .join("\n") + "\n";
}

function humanRead(data: ReturnType<typeof readTableData>): string {
  const heading = data.headingPath.length ? data.headingPath.join(" > ") : "(root)";
  const header = [
    `# id: ${data.id}`,
    `# heading: ${heading}`,
    `# lines: ${data.startLine}-${data.endLine}`,
    `# rows: ${data.rowCount}`,
    `# sha256: ${data.sha256}`,
    "",
  ].join("\n");
  const cols = data.columns;
  const widths = cols.map((c, i) =>
    Math.max(
      c.length,
      ...data.rows.map((r) => String(r[c] ?? "").length),
      i === i ? 3 : 3,
    ),
  );
  const fmt = (cells: string[]) =>
    "| " + cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ") + " |";
  const lines = [
    fmt(cols),
    fmt(cols.map((_, i) => "-".repeat(widths[i] ?? 3))),
    ...data.rows.map((r) => fmt(cols.map((c) => String(r[c] ?? "")))),
  ];
  return header + lines.join("\n") + "\n";
}

function printMutate(args: ParsedArgs, result: MutateResult, io: Io): void {
  if (args.json) {
    printJson(
      okEnvelope(
        {
          tableId: result.tableId,
          wrote: result.wrote,
          rowsAffected: result.rowsAffected,
          hashBefore: result.hashBefore,
          hashAfter: result.hashAfter,
          diff: result.diff,
        },
        result.changed,
      ),
      io.stdout,
    );
    return;
  }
  const status = result.wrote
    ? "wrote"
    : result.changed
      ? "diff (pass --write to apply)"
      : "unchanged";
  io.stdout.write(
    `${status}\ttable=${result.tableId}\trowsAffected=${result.rowsAffected}\thashBefore=${result.hashBefore}\thashAfter=${result.hashAfter}\n`,
  );
  if (result.changed && !result.wrote) io.stdout.write(result.diff);
}

export async function run(argv: string[], io: Io = process): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgv(argv);
  } catch (err) {
    return fail(err, false, io);
  }

  if (args.version && !args.command) {
    io.stdout.write(`${VERSION}\n`);
    return EXIT.ok;
  }
  if (args.help && !args.command) {
    io.stdout.write(HELP_MAIN);
    return EXIT.ok;
  }
  if (args.help && args.command) {
    io.stdout.write(commandHelp(args.command));
    return EXIT.ok;
  }
  if (!args.command) {
    io.stderr.write(HELP_MAIN);
    return EXIT.usage;
  }

  try {
    const fileArg = requireFile(args);
    const { path: filePath, bytes } = await readFileBytes(fileArg, args.followSymlinks);
    const doc = parseMarkdown(bytes, filePath);

    switch (args.command) {
      case "list": {
        const tables = listTables(doc);
        if (args.json) {
          printJson(okEnvelope({ file: filePath, tables }, false), io.stdout);
        } else {
          io.stdout.write(humanList(filePath, tables));
        }
        return EXIT.ok;
      }
      case "read": {
        const data = readTableData(doc, requireTableSel(args));
        if (args.json) printJson(okEnvelope(data, false), io.stdout);
        else io.stdout.write(humanRead(data));
        return EXIT.ok;
      }
      case "upsert": {
        if (!args.key) throw new AppError("missing --key COL", EXIT.usage);
        if (!args.rowJson) throw new AppError("missing --row-json JSON", EXIT.usage);
        const result = await maybeWrite(
          filePath,
          upsert(doc, requireTableSel(args), args.key, parseJsonObject(args.rowJson, "--row-json"), args.ifHash),
          args.write,
        );
        printMutate(args, result, io);
        return EXIT.ok;
      }
      case "update": {
        if (!args.whereJson) throw new AppError("missing --where-json JSON", EXIT.usage);
        if (!args.setJson) throw new AppError("missing --set-json JSON", EXIT.usage);
        const result = await maybeWrite(
          filePath,
          updateRows(
            doc,
            requireTableSel(args),
            parseJsonObject(args.whereJson, "--where-json"),
            parseJsonObject(args.setJson, "--set-json"),
            args.ifHash,
          ),
          args.write,
        );
        printMutate(args, result, io);
        return EXIT.ok;
      }
      case "delete": {
        if (!args.whereJson) throw new AppError("missing --where-json JSON", EXIT.usage);
        const result = await maybeWrite(
          filePath,
          deleteRows(
            doc,
            requireTableSel(args),
            parseJsonObject(args.whereJson, "--where-json"),
            args.ifHash,
          ),
          args.write,
        );
        printMutate(args, result, io);
        return EXIT.ok;
      }
      case "validate": {
        const result = validateTable(
          doc,
          requireTableSel(args),
          args.required ?? [],
          args.unique ?? [],
        );
        if (args.json) {
          printJson(
            {
              schemaVersion: 1,
              ok: result.ok,
              changed: false,
              data: { tableId: result.tableId },
              diagnostics: result.diagnostics,
            },
            io.stdout,
          );
        } else {
          if (result.ok && result.diagnostics.length === 0) {
            io.stdout.write(`ok\ttable=${result.tableId}\n`);
          } else {
            for (const d of result.diagnostics) {
              const loc = [
                d.line !== undefined ? `line ${d.line}` : null,
                d.column ? `column ${d.column}` : null,
              ]
                .filter(Boolean)
                .join(", ");
              io.stdout.write(`${d.level}\t${d.message}${loc ? ` (${loc})` : ""}\n`);
            }
            if (result.ok) io.stdout.write(`ok\ttable=${result.tableId}\n`);
          }
        }
        return result.ok ? EXIT.ok : EXIT.validation;
      }
      case "sort": {
        if (!args.by) throw new AppError("missing --by COL", EXIT.usage);
        const result = await maybeWrite(
          filePath,
          sortRows(doc, requireTableSel(args), args.by, args.ifHash),
          args.write,
        );
        printMutate(args, result, io);
        return EXIT.ok;
      }
      case "dedupe": {
        if (!args.key) throw new AppError("missing --key COL", EXIT.usage);
        const result = await maybeWrite(
          filePath,
          dedupeRows(doc, requireTableSel(args), args.key, args.ifHash),
          args.write,
        );
        printMutate(args, result, io);
        return EXIT.ok;
      }
      default:
        throw new AppError("unknown command", EXIT.usage);
    }
  } catch (err) {
    return fail(err, args.json, io);
  }
}

function fail(err: unknown, json: boolean, io: Io): number {
  if (err instanceof AppError) {
    if (json) {
      printJson(
        errEnvelope([
          {
            level: "error",
            message: err.message,
            file: err.details.file,
            table: err.details.table,
            column: err.details.column,
            line: err.details.line,
          },
        ]),
        io.stdout,
      );
    } else {
      io.stderr.write(`${formatError(err)}\n`);
    }
    return err.exitCode;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    printJson(errEnvelope([{ level: "error", message }]), io.stdout);
  } else {
    io.stderr.write(`mdtableops: ${message}\n`);
  }
  return EXIT.error;
}
