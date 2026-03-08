/** Strip ANSI escape sequences, control characters, and BiDi overrides to prevent terminal injection. */
const CONTROL_RE =
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]|[\u202A-\u202E\u2066-\u2069]/g;

export function sanitize(text: string): string {
  return text.replace(CONTROL_RE, '');
}
