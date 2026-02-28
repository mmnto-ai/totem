import ts from 'typescript';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';
import type { ChunkStrategy, ContentType } from '../config-schema.js';

/**
 * Schema File Chunker.
 *
 * Chunks by exported table/relation declarations (Drizzle pgTable, Prisma, etc.).
 * Falls back to chunking by each exported statement.
 */
export class SchemaFileChunker implements Chunker {
  readonly strategy: ChunkStrategy = 'schema-file';

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
      if (!this.isExported(node)) return;

      let name = 'unknown';

      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            name = decl.name.text;
          }
        }
      } else if (
        (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
        node.name
      ) {
        name = node.name.text;
      }

      const startPos = node.getStart(sourceFile);
      const endPos = node.getEnd();
      const startLine = sourceFile.getLineAndCharacterOfPosition(startPos).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(endPos).line + 1;

      const text = lines.slice(startLine - 1, endLine).join('\n');

      chunks.push({
        content: text,
        contextPrefix: `File: ${filePath} | Schema: ${name}`,
        filePath,
        type,
        strategy: this.strategy,
        label: `schema: ${name}`,
        startLine,
        endLine,
        metadata: { name },
      });
    });

    return chunks;
  }

  private isExported(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
}
