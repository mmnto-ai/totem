/**
 * Infer the next milestone from the current one by bumping the minor version.
 * Returns undefined for non-semver strings.
 */
export function inferNextMilestone(current: string | undefined | null): string | undefined {
  if (!current) return undefined;
  // Match milestone titles like "1.6.0", "v1.6.0", "1.6.0 — Pipeline Maturity"
  const match = current.match(/^(v?)(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  const [, prefix, major, minor, _patch] = match;
  return `${prefix}${major}.${Number(minor) + 1}.0`;
}
