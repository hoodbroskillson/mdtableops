import { EXIT, type ExitCode } from "./codes.js";

export interface ErrorDetails {
  file?: string;
  table?: string;
  column?: string;
  line?: number;
}

export class AppError extends Error {
  readonly exitCode: ExitCode;
  readonly details: ErrorDetails;

  constructor(message: string, exitCode: ExitCode, details: ErrorDetails = {}) {
    super(message);
    this.name = "AppError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function usage(message: string): AppError {
  return new AppError(message, EXIT.usage);
}

export function formatError(err: AppError): string {
  const bits: string[] = [];
  if (err.details.file) bits.push(`file: ${err.details.file}`);
  if (err.details.table) bits.push(`table: ${err.details.table}`);
  if (err.details.column) bits.push(`column: ${err.details.column}`);
  if (err.details.line !== undefined) bits.push(`line: ${err.details.line}`);
  const suffix = bits.length ? ` (${bits.join(", ")})` : "";
  return `mdtableops: ${err.message}${suffix}`;
}
