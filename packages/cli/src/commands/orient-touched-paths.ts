// The touched-path set `totem orient`'s action-policy section judges
// (mmnto-ai/totem#3106): the branch diff the legs floor reads, plus the working
// tree's changed paths. Its own module so the orient tests can replace the git
// reads without a repository fixture.

/** The `-z` record separator (NUL). */
const NUL = '\0';

/** Porcelain status codes whose record is followed by the ORIGINAL path. */
const RENAME_OR_COPY = /[RC]/;

/** Width of the porcelain `XY ` status prefix before the path column. */
const PORCELAIN_PREFIX_LEN = 3;

/**
 * The working tree's changed paths from `git status --porcelain -z`: the path
 * column of each record, raw (the `-z` form never C-quotes, the spelling the
 * legs reach probe uses). A rename or copy record is followed by its original
 * path, which is skipped: the new path is the one on disk.
 */
export function parsePorcelainPaths(raw: string): string[] {
  const records = raw.split(NUL);
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as string;
    if (record.length <= PORCELAIN_PREFIX_LEN) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(PORCELAIN_PREFIX_LEN));
    if (RENAME_OR_COPY.test(status)) i++;
  }
  return paths;
}

/**
 * The repo-relative paths this branch touches: `git diff --name-only -z
 * <base>...HEAD` through the legs floor's own base resolution
 * (`resolveUnfilteredBranchScope`, which reads the list with `legReachPaths`),
 * united with the working tree's changed paths. Sorted, deduplicated. Throws
 * when git cannot resolve the scope; the caller reports it as one line.
 */
export async function deriveTouchedPaths(repoRoot: string): Promise<string[]> {
  const { getGitStatusPorcelainRaw } = await import('@mmnto/totem');
  const { resolveUnfilteredBranchScope } = await import('./legs.js');
  const scope = await resolveUnfilteredBranchScope(repoRoot, { suppressScopeNarration: true });
  // Raw and untrimmed: the first record's status column can open with a space,
  // which a trim would eat along with the path's first character.
  const status = getGitStatusPorcelainRaw(repoRoot);
  return [...new Set([...scope.files, ...parsePorcelainPaths(status)])].sort();
}
