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
  },
};
