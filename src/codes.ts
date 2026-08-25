/** Process exit codes used by mdtableops. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  missingTable: 3,
  ambiguous: 4,
  hashMismatch: 5,
  validation: 6,
  symlink: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
