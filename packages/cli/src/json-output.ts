/** Structured JSON envelope for CLI output (no Zod — plain TS interfaces) */
export interface TotemJsonSuccess<T> {
  status: 'success';
  command: string;
  data: T;
}

export interface TotemJsonError {
  status: 'error';
  command: string;
  error: {
    message: string;
    fix?: string;
    code?: string;
  };
}

export type TotemJsonResponse<T> = TotemJsonSuccess<T> | TotemJsonError;

/** Print JSON response to stdout. All other output must go to stderr when --json is active. */
export function printJson<T>(response: TotemJsonResponse<T>): void {
  process.stdout.write(JSON.stringify(response, null, 2) + '\n');
}

/** Check if --json flag is active on the root program */
export function isJsonMode(): boolean {
  return process.env['TOTEM_JSON_OUTPUT'] === '1';
}
