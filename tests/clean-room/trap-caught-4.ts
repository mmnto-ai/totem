// Adversarial corpus: trap-caught for indexOf+1 off-by-one
// This code SHOULD trigger a violation.
// Rule: $A[$A.indexOf($B) + 1]
// Bug: if indexOf returns -1 (not found), -1+1 = 0 silently returns
// the first element instead of signaling a missing value.

function getArgValue(args: string[]): string | undefined {
  const val = args[args.indexOf('--model') + 1];
  return val;
}

export { getArgValue };
