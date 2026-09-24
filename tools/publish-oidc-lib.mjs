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
