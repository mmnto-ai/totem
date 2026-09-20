'use strict';

const transforms = require('./tools/docs-transforms.cjs');

/**
 * markdown-magic configuration.
 * Transforms inject live project data into doc markers.
 *
 * Marker format (in .md files):
 *   <!-- docs TRANSFORM_NAME -->
 *   ...content replaced on each run...
 *   <!-- /docs -->
 */
module.exports = {
  files: ['README.md', 'docs/**/*.md'],
  transforms: {
    RULE_COUNT: transforms.RULE_COUNT,
    HOOK_LIST: transforms.HOOK_LIST,
    CHMOD_HOOKS: transforms.CHMOD_HOOKS,
    COMMAND_TABLE: transforms.COMMAND_TABLE,
    MATURITY_TABLE: transforms.MATURITY_TABLE,
    RULE_PROVENANCE: transforms.RULE_PROVENANCE,
    DAYS_UNDER_FREEZE: transforms.DAYS_UNDER_FREEZE,
    LINT_RECEIPT: transforms.LINT_RECEIPT,
    // Inline figures for prose (a fragment between markers inside a sentence).
    RULE_PROVENANCE_RATIO: transforms.RULE_PROVENANCE_RATIO,
    NON_ARCHIVED_RULE_COUNT: transforms.NON_ARCHIVED_RULE_COUNT,
    LESSON_RECORD_COUNT: transforms.LESSON_RECORD_COUNT,
    FREEZE_SINCE_MONTH: transforms.FREEZE_SINCE_MONTH,
  },
};
