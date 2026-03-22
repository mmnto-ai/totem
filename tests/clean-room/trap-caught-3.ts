// Adversarial corpus: trap-caught for RegExp flag append
// This code SHOULD trigger a violation.
// Rule: new RegExp($SRC, $FLAGS + 'g')
// Bug: blindly appending 'g' can duplicate the flag if it's already present,
// causing a SyntaxError at runtime.

function makeGlobal(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags + 'g');
}

export { makeGlobal };
