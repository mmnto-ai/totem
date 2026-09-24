/**
 * Pure helpers for `tools/publish-oidc.mjs`, kept apart so they can be tested
 * without running the publish script (which acts on import).
 */

/**
 * Classify a failed `npm publish` from its captured output.
 *
 * `staged`: the registry answered E409 "Cannot publish over previously staged
 * version" — the version was accepted by an EARLIER publish call and is being
 * promoted (measured on the 2.11.1 cut: `@mmnto/cli` stayed staged about
 * 20 minutes while its siblings promoted in seconds, mmnto-ai/totem#2953). A
 * re-run therefore cannot publish it again; the package IS published and the
 * verify step must wait for its promotion.
 *
 * `failed`: anything else (E404 with a trusted-publisher mismatch, E403, a
 * network fault) — the publish did not happen.
 */
export const classifyPublishFailure = (output) => {
  const text = String(output ?? '');
  if (/\bE409\b/.test(text) && /previously staged version/i.test(text)) return 'staged';
  return 'failed';
};

/**
 * May a staged version be counted as published by THIS run? Only on a re-run
 * of the same workflow run (`GITHUB_RUN_ATTEMPT` > 1): the sha is then the one
 * that built the tarball the registry holds, so the tag and release the script
 * makes for it point at the right commit. On a first attempt an E409-staged
 * answer means another run's publish, at another commit, is still promoting;
 * counting it here would move the release tag to a commit that did not build
 * the tarball (the falsification leg's finding on mmnto-ai/totem#2953), so the
 * script fails loud and names the wait instead.
 */
export const stagedCountsAsPublished = (env) => {
  const attempt = Number(env?.GITHUB_RUN_ATTEMPT ?? '1');
  return Number.isFinite(attempt) && attempt > 1;
};
