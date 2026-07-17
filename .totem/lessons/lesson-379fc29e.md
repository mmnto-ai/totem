## Lesson — Avoid require.resolve for package.json

**Tags:** node, commonjs, esm, dependencies
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Using `require.resolve` on a package's `package.json` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` if the target's `exports` map only defines an `import` condition. To read the manifest safely, manually walk `node_modules` and read the file directly from disk, as `exports` maps do not restrict direct filesystem reads.
