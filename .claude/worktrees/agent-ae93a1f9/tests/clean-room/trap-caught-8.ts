// Adversarial corpus: trap-caught for ast-grep findAll type check
// This code SHOULD trigger a violation.
// Rule: $NODE.findAll(typeof $X === 'string' ? $Y : $Z)
// Bug: pushing type-dispatch into findAll is fragile; let ast-grep
// handle pattern normalization internally.

interface SgNode {
  findAll(pattern: string | { rule: unknown }): SgNode[];
}

function search(root: SgNode, pattern: string | { rule: unknown }): SgNode[] {
  return root.findAll(typeof pattern === 'string' ? pattern : pattern.rule);
}

export { search };
