'use strict';

/**
 * Runner script for markdown-magic doc injection.
 * Usage: node tools/docs-inject.cjs
 *
 * Reads md.config.cjs and processes all target files,
 * replacing marker blocks with live project data.
 */
const { markdownMagic } = require('markdown-magic');
const config = require('../md.config.cjs');

markdownMagic(config)
  .then((result) => {
    if (result.filesChanged.length) {
      console.log(`Updated ${result.filesChanged.length} file(s).`);
    } else {
      console.log('No changes detected.');
    }
  })
  .catch((err) => {
    console.error('docs:inject failed:', err.message || err);
    process.exit(1);
  });
