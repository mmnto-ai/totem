// Adversarial corpus: trap-bypassed for indexOf+1 off-by-one
// This code SHOULD NOT trigger a violation.
// Properly checks the indexOf result before using it as an index.

function getArgValue(args: string[]): string | undefined {
  const idx = args.indexOf('--model');
  const val = idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  return val;
}

export { getArgValue };
