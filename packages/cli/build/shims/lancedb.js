/**
 * LanceDB shim for the Totem Lite binary.
 * Vector store is not available in the lite tier.
 * Any code path that reaches this will throw a clear error.
 */

const LITE_ERROR =
  '[Totem Lite] Vector store requires the full Totem installation. Install: npm install -g @mmnto/cli';

export function connect() {
  throw new Error(LITE_ERROR);
}

export const Index = {
  fts() {
    throw new Error(LITE_ERROR);
  },
};

export class Table {
  constructor() {
    throw new Error(LITE_ERROR);
  }
}
