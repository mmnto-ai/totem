export function handle(input: string): string {
  try { risky(input); } catch (e) { }
  return input;
}
