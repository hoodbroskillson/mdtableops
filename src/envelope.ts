import { SCHEMA_VERSION } from "./version.js";
import type { Diagnostic, Envelope } from "./types.js";

export function okEnvelope<T>(data: T, changed: boolean, diagnostics: Diagnostic[] = []): Envelope<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    changed,
    data,
    diagnostics,
  };
}

export function errEnvelope(diagnostics: Diagnostic[], data: unknown = {}): Envelope<unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    changed: false,
    data,
    diagnostics,
  };
}

export function printJson(value: unknown, stdout: NodeJS.WritableStream): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
