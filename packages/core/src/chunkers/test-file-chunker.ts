import ts from 'typescript';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';
import type { ChunkStrategy, ContentType } from '../config-schema.js';

const TEST_FUNCTIONS = new Set(['describe', 'it', 'test']);

/**
 * Test File Chunker.
 *
 * Chunks by describe/it/test blocks.
 * A `describe` block includes its nested `it` calls.
 * Top-level `it`/`test` calls become their own chunks.
 */
export class TestFileChunker implements Chunker {
  readonly strategy: ChunkStrategy = 'test-file';

  chunk(content: string, filePath: string, type: ContentType): Chunk[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const chunks: Chunk[] = [];
    const lines = content.split('\n');

    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isExpressionStatement(node)) return;
      if (!ts.isCallExpression(node.expression)) return;

      const callName = this.getCallName(node.expression);
      if (!callName || !TEST_FUNCTIONS.has(callName)) return;

      const label = this.extractTestLabel(node.expression);
      const startPos = node.getStart(sourceFile);
      const endPos = node.getEnd();
      const startLine = sourceFile.getLineAndCharacterOfPosition(startPos).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(endPos).line + 1;

      const text = lines.slice(startLine - 1, endLine).join('\n');

      chunks.push({
        content: text,
        contextPrefix: `File: ${filePath} | Test: ${label}`,
        filePath,
        type,
        strategy: this.strategy,
        label: `${callName}: ${label}`,
        startLine,
        endLine,
        metadata: { testType: callName },
      });
    });

    return chunks;
  }

  private getCallName(expr: ts.CallExpression): string | null {
    if (ts.isIdentifier(expr.expression)) {
      return expr.expression.text;
    }
    // Handle describe.skip, it.skip, etc.
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.expression)
    ) {
      return expr.expression.expression.text;
    }
    return null;
  }

  private extractTestLabel(expr: ts.CallExpression): string {
    const firstArg = expr.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      return firstArg.text;
    }
    if (firstArg && ts.isNoSubstitutionTemplateLiteral(firstArg)) {
      return firstArg.text;
    }
    return 'unnamed';
  }
}
