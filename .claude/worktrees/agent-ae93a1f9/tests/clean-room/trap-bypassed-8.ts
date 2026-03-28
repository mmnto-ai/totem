// Adversarial corpus: trap-bypassed for ast-grep findAll type check
// This code SHOULD NOT trigger a violation.
// Passes the pattern directly, letting ast-grep handle type dispatch.

interface SgNode {
  findAll(pattern: string | { rule: unknown }): SgNode[];
}

function search(root: SgNode, pattern: string | { rule: unknown }): SgNode[] {
  return root.findAll(pattern);
}

export { search };
