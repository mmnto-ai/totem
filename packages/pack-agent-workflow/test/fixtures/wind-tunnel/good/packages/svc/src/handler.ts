export function handle(input: string): string {
  try { risky(input); } catch (e) { console.warn("optional cleanup failed", e); }
  try { alsoRisky(input); } catch (e) { return input; }
  return input;
}
