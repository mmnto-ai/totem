// Adversarial corpus: trap-bypassed for RegExp flag append
// This code SHOULD NOT trigger a violation.
// Checks whether 'g' is already present before appending.

function makeGlobal(pattern: string, flags: string): RegExp {
  const safeFlags = flags.includes('g') ? flags : flags + 'g';
  return new RegExp(pattern, safeFlags);
}

export { makeGlobal };
