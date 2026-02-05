import * as vscode from 'vscode';
import { BaseParser } from './baseParser.js';
import { ImportInfo, ParseResult } from '../models/index.js';

/**
 * Parser for Python import statements
 */
export class PythonParser extends BaseParser {
  // Match: import package or import package as alias (supports dotted names like google.generativeai)
  private static readonly IMPORT_REGEX = /^import\s+([\w.]+)(?:\s+as\s+\w+)?/;

  // Match: from package import ... (handles multi-line with backslash or parentheses)
  private static readonly FROM_IMPORT_REGEX = /^from\s+([\w.]+)\s+import\s+(.+)/;

  // Match: import package1, package2, ... (supports dotted names)
  private static readonly MULTI_IMPORT_REGEX = /^import\s+([\w.\s,]+)/;

  getLanguage(): 'python' | 'javascript' | 'typescript' {
    return 'python';
  }

  parse(): ParseResult {
    const imports: ImportInfo[] = [];
    const errors: string[] = [];
    const text = this.document.getText();
    const lines = text.split('\n');

    let lineIndex = 0;
    while (lineIndex < lines.length) {
      const line = lines[lineIndex].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        lineIndex++;
        continue;
      }

      try {
        // Try to parse 'from x import y' style
        const fromMatch = line.match(PythonParser.FROM_IMPORT_REGEX);
        if (fromMatch) {
          const result = this.parseFromImport(fromMatch, lineIndex, lines);
          if (result.import) {
            imports.push(result.import);
          }
          lineIndex = result.nextLineIndex;
          continue;
        }

        // Try to parse 'import x, y, z' style
        const multiMatch = line.match(PythonParser.MULTI_IMPORT_REGEX);
        if (multiMatch) {
          const parsedImports = this.parseMultiImport(multiMatch, lineIndex);
          imports.push(...parsedImports);
          lineIndex++;
          continue;
        }

        // Try to parse simple 'import x' style
        const importMatch = line.match(PythonParser.IMPORT_REGEX);
        if (importMatch) {
          const packageName = importMatch[1];
          if (!this.isRelativeImport(packageName)) {
            imports.push({
              packageName,
              importStatement: lines[lineIndex],
              language: 'python',
              range: this.getLineRange(lineIndex),
              fileUri: this.document.uri,
            });
          }
          lineIndex++;
          continue;
        }
      } catch (error) {
        errors.push(`Error parsing line ${lineIndex + 1}: ${error}`);
      }

      lineIndex++;
    }

    return { imports, errors };
  }

  private parseFromImport(
    match: RegExpMatchArray,
    startLine: number,
    lines: string[]
  ): { import: ImportInfo | null; nextLineIndex: number } {
    const packagePath = match[1];

    // Skip relative imports (starting with .)
    if (packagePath.startsWith('.')) {
      return { import: null, nextLineIndex: startLine + 1 };
    }

    // Use the full package path (e.g., google.generativeai, not just google)
    const packageName = packagePath;
    let importContent = match[2];
    let endLine = startLine;

    // Handle multi-line imports with parentheses
    if (importContent.includes('(') && !importContent.includes(')')) {
      while (endLine < lines.length - 1 && !lines[endLine].includes(')')) {
        endLine++;
        importContent += ' ' + lines[endLine].trim();
      }
    }

    // Handle multi-line imports with backslash
    while (lines[endLine].trimEnd().endsWith('\\') && endLine < lines.length - 1) {
      endLine++;
      importContent += ' ' + lines[endLine].trim();
    }

    // Parse named imports
    const namedImports = this.parseNamedImports(importContent);

    const fullStatement = lines.slice(startLine, endLine + 1).join('\n');

    return {
      import: {
        packageName,
        importStatement: fullStatement,
        language: 'python',
        range: this.createRange(
          startLine,
          0,
          endLine,
          lines[endLine].length
        ),
        fileUri: this.document.uri,
        namedImports,
      },
      nextLineIndex: endLine + 1,
    };
  }

  private parseMultiImport(match: RegExpMatchArray, lineIndex: number): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const packagesStr = match[1];

    // Split by comma and handle 'as' aliases
    const packages = packagesStr.split(',').map((p) => {
      const parts = p.trim().split(/\s+as\s+/);
      return parts[0].trim();
    });

    for (const packageName of packages) {
      if (packageName && !this.isRelativeImport(packageName)) {
        imports.push({
          packageName,
          importStatement: this.document.lineAt(lineIndex).text,
          language: 'python',
          range: this.getLineRange(lineIndex),
          fileUri: this.document.uri,
        });
      }
    }

    return imports;
  }

  private parseNamedImports(content: string): string[] {
    // Remove parentheses if present
    content = content.replace(/[()]/g, '');

    // Split by comma and extract names (handle 'as' aliases)
    return content
      .split(',')
      .map((item) => {
        const parts = item.trim().split(/\s+as\s+/);
        return parts[0].trim();
      })
      .filter((name) => name && name !== '*');
  }

  private getLineRange(lineIndex: number): vscode.Range {
    const line = this.document.lineAt(lineIndex);
    return new vscode.Range(
      new vscode.Position(lineIndex, 0),
      new vscode.Position(lineIndex, line.text.length)
    );
  }
}
