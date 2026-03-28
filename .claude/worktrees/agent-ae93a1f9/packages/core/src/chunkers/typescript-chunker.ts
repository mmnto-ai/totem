import ts from 'typescript';

import type { ChunkStrategy, ContentType } from '../config-schema.js';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';

/**
 * TypeScript AST Chunker.
 *
 * Chunks by function, class, interface, type alias, enum declarations.
 * Detects React components (PascalCase) and hooks (use* prefix).
 * Context: `File: <path> | Context: The '<name>' <kind>`
 */
export class TypeScriptChunker implements Chunker {
  readonly strategy: ChunkStrategy = 'typescript-ast';

  chunk(content: string, filePath: string, type: ContentType): Chunk[] {
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );

    const chunks: Chunk[] = [];
    const lines = content.split('\n');

    const visit = (node: ts.Node, depth: number) => {
      // Only chunk top-level declarations (class methods stay inside the class chunk)
      if (depth > 1) return;

      const extracted = this.extractDeclaration(node, sourceFile, lines, filePath, type);
      if (extracted) {
        chunks.push(extracted);
        return;
      }

      ts.forEachChild(node, (child) => visit(child, depth + 1));
    };

    ts.forEachChild(sourceFile, (child) => visit(child, 0));

    return chunks;
  }

  private extractDeclaration(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    lines: string[],
    filePath: string,
    contentType: ContentType,
  ): Chunk | null {
    let name: string | null = null;
    let kind: string | null = null;

    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
      kind = this.classifyFunction(name);
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
      kind = 'class';
    } else if (ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
      kind = 'interface';
    } else if (ts.isTypeAliasDeclaration(node)) {
      name = node.name.text;
      kind = 'type alias';
    } else if (ts.isEnumDeclaration(node)) {
      name = node.name.text;
      kind = 'enum';
    } else if (ts.isVariableStatement(node)) {
      // Handle: export const MyComponent = () => { ... }
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            name = decl.name.text;
            kind = this.classifyFunction(name);
          }
        }
      }
    }

    if (!name || !kind) return null;

    const startPos = node.getStart(sourceFile);
    const endPos = node.getEnd();
    const startLine = sourceFile.getLineAndCharacterOfPosition(startPos).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(endPos).line + 1;

    const text = lines.slice(startLine - 1, endLine).join('\n');
    const contextPrefix = `File: ${filePath} | Context: The '${name}' ${kind}`;

    return {
      content: text,
      contextPrefix,
      filePath,
      type: contentType,
      strategy: this.strategy,
      label: `${kind}: ${name}`,
      startLine,
      endLine,
      metadata: { name, kind },
    };
  }

  private classifyFunction(name: string): string {
    if (name.startsWith('use') && name[3]?.toUpperCase() === name[3]) {
      return 'hook';
    }
    if (name[0]?.toUpperCase() === name[0]) {
      return 'component';
    }
    return 'function';
  }
}
