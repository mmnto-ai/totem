/**
 * Auto-close enforcement seam (mmnto-ai/totem#1762) — the ONE shared evaluator
 * consumed by D1 (PR-time check), D2 (post-merge reconciliation), and C's hook
 * templates. Import the pattern / evaluator from here; never copy the regex.
 */

export type { AutoCloseMatch } from './matcher.js';
export {
  AUTO_CLOSE_KEYWORDS,
  AUTO_CLOSE_REGEX_SOURCE,
  autoCloseKeyForms,
  findAutoCloseRefs,
} from './matcher.js';
export type { MergeConfigPosture, MergeConfigVerdict } from './merge-config.js';
export {
  evaluateMergeConfigPosture,
  REQUIRED_SQUASH_MERGE_MESSAGE,
  REQUIRED_SQUASH_MERGE_TITLE,
} from './merge-config.js';
export type {
  AutoCloseReceipt,
  ClosingIssueRef,
  DeclaredIntentRef,
  PrCorpus,
  PrScanResult,
  ReconcileOptions,
  ReconcileResult,
  ReconcileStatus,
} from './receipt.js';
export {
  AUTO_CLOSE_RECEIPT_SCHEMA_VERSION,
  buildDeclaredCloseKeys,
  buildReceipt,
  parseDeclaredCloseIntent,
  reconcile,
  scanPrCorpus,
} from './receipt.js';
