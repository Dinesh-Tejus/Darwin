import * as vscode from 'vscode';
import { BaseParser } from './baseParser.js';
import { ImportInfo, ParseResult } from '../models/index.js';

/**
 * Parser for JavaScript/TypeScript import statements
 */
export class JsTsParser extends BaseParser {
  // ES6 import patterns
  private static readonly ES6_IMPORT_REGEX =
    /import\s+(?:(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?(?:\s*,\s*(\w+))?\s+from\s+)?['"]([^'"]+)['"]/g;

  // CommonJS require pattern
  private static readonly REQUIRE_REGEX =
    /(?:const|let|var)\s+(?:(\w+)|\{([^}]+)\})\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  // Dynamic import pattern
  private static readonly DYNAMIC_IMPORT_REGEX = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  // Re-export pattern
  private static readonly REEXPORT_REGEX = /export\s+(?:\*|\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/g;

  getLanguage(): 'python' | 'javascript' | 'typescript' {
    const langId = this.document.languageId;
    if (langId === 'typescript' || langId === 'typescriptreact') {
      return 'typescript';
    }
    return 'javascript';
  }

  parse(): ParseResult {
    const imports: ImportInfo[] = [];
    const errors: string[] = [];
    const text = this.document.getText();

    try {
      // Parse ES6 imports
      this.parseES6Imports(text, imports);

      // Parse CommonJS requires
      this.parseRequires(text, imports);

      // Parse dynamic imports
      this.parseDynamicImports(text, imports);

      // Parse re-exports
      this.parseReexports(text, imports);
    } catch (error) {
      errors.push(`Error parsing imports: ${error}`);
    }

    // Remove duplicates based on package name
    const uniqueImports = this.deduplicateImports(imports);

    return { imports: uniqueImports, errors };
  }

  private parseES6Imports(text: string, imports: ImportInfo[]): void {
    const regex = new RegExp(JsTsParser.ES6_IMPORT_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const defaultImport = match[1];
      const namedImportsStr = match[2];
      const namespaceImport = match[3];
      const modulePath = match[4];

      if (this.isRelativeImport(modulePath)) {
        continue;
      }

      const packageName = this.getTopLevelPackage(modulePath);
      const namedImports = namedImportsStr
        ? this.parseNamedImports(namedImportsStr)
        : undefined;

      const position = this.document.positionAt(match.index);
      const endPosition = this.document.positionAt(match.index + match[0].length);

      imports.push({
        packageName,
        importStatement: match[0],
        language: this.getLanguage(),
        range: new vscode.Range(position, endPosition),
        fileUri: this.document.uri,
        namedImports,
        isDefaultImport: !!defaultImport || !!namespaceImport,
        isRequire: false,
      });
    }
  }

  private parseRequires(text: string, imports: ImportInfo[]): void {
    const regex = new RegExp(JsTsParser.REQUIRE_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const defaultImport = match[1];
      const namedImportsStr = match[2];
      const modulePath = match[3];

      if (this.isRelativeImport(modulePath)) {
        continue;
      }

      const packageName = this.getTopLevelPackage(modulePath);
      const namedImports = namedImportsStr
        ? this.parseNamedImports(namedImportsStr)
        : undefined;

      const position = this.document.positionAt(match.index);
      const endPosition = this.document.positionAt(match.index + match[0].length);

      imports.push({
        packageName,
        importStatement: match[0],
        language: this.getLanguage(),
        range: new vscode.Range(position, endPosition),
        fileUri: this.document.uri,
        namedImports,
        isDefaultImport: !!defaultImport,
        isRequire: true,
      });
    }
  }

  private parseDynamicImports(text: string, imports: ImportInfo[]): void {
    const regex = new RegExp(JsTsParser.DYNAMIC_IMPORT_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const modulePath = match[1];

      if (this.isRelativeImport(modulePath)) {
        continue;
      }

      const packageName = this.getTopLevelPackage(modulePath);
      const position = this.document.positionAt(match.index);
      const endPosition = this.document.positionAt(match.index + match[0].length);

      imports.push({
        packageName,
        importStatement: match[0],
        language: this.getLanguage(),
        range: new vscode.Range(position, endPosition),
        fileUri: this.document.uri,
        isRequire: false,
      });
    }
  }

  private parseReexports(text: string, imports: ImportInfo[]): void {
    const regex = new RegExp(JsTsParser.REEXPORT_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const modulePath = match[1];

      if (this.isRelativeImport(modulePath)) {
        continue;
      }

      const packageName = this.getTopLevelPackage(modulePath);
      const position = this.document.positionAt(match.index);
      const endPosition = this.document.positionAt(match.index + match[0].length);

      imports.push({
        packageName,
        importStatement: match[0],
        language: this.getLanguage(),
        range: new vscode.Range(position, endPosition),
        fileUri: this.document.uri,
        isRequire: false,
      });
    }
  }

  private parseNamedImports(namedImportsStr: string): string[] {
    return namedImportsStr
      .split(',')
      .map((item) => {
        // Handle 'originalName as alias' syntax
        const parts = item.trim().split(/\s+as\s+/);
        return parts[0].trim();
      })
      .filter((name) => name.length > 0);
  }

  private deduplicateImports(imports: ImportInfo[]): ImportInfo[] {
    const seen = new Map<string, ImportInfo>();

    for (const imp of imports) {
      const key = imp.packageName;
      if (!seen.has(key)) {
        seen.set(key, imp);
      }
    }

    return Array.from(seen.values());
  }
}
