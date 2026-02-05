import * as vscode from 'vscode';
import { ImportInfo, DeprecationInfo, MigrationInfo, MigrationDocSearchResult } from '../models/index.js';
import { isPackageIgnored, logInfo, logWarning, logError } from '../utils/index.js';
import { getCachedDeprecation, cacheDeprecation } from './cacheService.js';
import { searchDeprecationStatus, searchMigrationDocs, extractSearchContent } from './tavilyService.js';
import { analyzeDeprecationStatus, generateMigratedCode } from './geminiService.js';

/**
 * Check if a package is deprecated
 */
export async function checkDeprecation(
  importInfo: ImportInfo,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<DeprecationInfo | null> {
  const { packageName, language } = importInfo;

  // Check if package is in ignore list
  if (isPackageIgnored(packageName)) {
    logInfo(`Skipping ignored package: ${packageName}`);
    return null;
  }

  // Check cache first
  const cached = getCachedDeprecation(packageName, language);
  if (cached) {
    logInfo(`Using cached result for ${packageName}`);
    return cached;
  }

  if (progress) {
    progress.report({ message: `Checking ${packageName}...` });
  }

  try {
    // Search for deprecation info
    logInfo(`Searching deprecation info for ${packageName}`);
    const searchResults = await searchDeprecationStatus(packageName, language);

    if (searchResults.length === 0) {
      // No results found, assume not deprecated
      const info: DeprecationInfo = {
        packageName,
        language,
        isDeprecated: false,
        confidence: 0.5,
        reason: 'No deprecation information found',
      };
      await cacheDeprecation(info);
      return info;
    }

    // Analyze with Gemini
    logInfo(`Analyzing ${packageName} with Gemini`);
    const analysis = await analyzeDeprecationStatus(packageName, language, searchResults);

    const info: DeprecationInfo = {
      packageName,
      language,
      isDeprecated: analysis.isDeprecated,
      reason: analysis.reason,
      replacement: analysis.replacement || undefined,
      confidence: analysis.confidence,
      sources: searchResults.map((r) => r.url),
    };

    // Only cache successful results (confidence > 0 indicates LLM call succeeded)
    if (analysis.confidence > 0) {
      await cacheDeprecation(info);
    }

    return info;
  } catch (error) {
    logError(`Failed to check deprecation for ${packageName}`, error as Error);
    // Return a safe default on error
    return {
      packageName,
      language,
      isDeprecated: false,
      confidence: 0,
      reason: `Error checking status: ${(error as Error).message}`,
    };
  }
}

/**
 * Check multiple packages for deprecation
 */
export async function checkMultipleDeprecations(
  imports: ImportInfo[],
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Map<string, DeprecationInfo>> {
  const results = new Map<string, DeprecationInfo>();
  const increment = imports.length > 0 ? 100 / imports.length : 0;

  for (const importInfo of imports) {
    const result = await checkDeprecation(importInfo, progress);
    if (result) {
      results.set(importInfo.packageName, result);
    }
    if (progress) {
      progress.report({ increment });
    }
  }

  return results;
}

/**
 * Get deprecated packages from results
 */
export function getDeprecatedPackages(
  results: Map<string, DeprecationInfo>
): DeprecationInfo[] {
  return Array.from(results.values()).filter((info) => info.isDeprecated);
}

/**
 * Search for migration documentation
 */
export async function findMigrationDocs(
  fromPackage: string,
  toPackage: string,
  language: string
): Promise<MigrationDocSearchResult> {
  try {
    logInfo(`Searching migration docs: ${fromPackage} -> ${toPackage}`);
    const results = await searchMigrationDocs(fromPackage, toPackage, language);

    if (results.length === 0) {
      return {
        found: false,
        urls: [],
        content: '',
      };
    }

    return {
      found: true,
      urls: results.map((r) => r.url),
      content: extractSearchContent(results),
    };
  } catch (error) {
    logError(`Failed to find migration docs`, error as Error);
    return {
      found: false,
      urls: [],
      content: '',
    };
  }
}

/**
 * Generate migration suggestion for a deprecated import
 */
export async function generateMigration(
  importInfo: ImportInfo,
  deprecationInfo: DeprecationInfo,
  document: vscode.TextDocument
): Promise<MigrationInfo | null> {
  if (!deprecationInfo.replacement) {
    logWarning(`No replacement known for ${importInfo.packageName}`);
    return null;
  }

  const fromPackage = importInfo.packageName;
  const toPackage = deprecationInfo.replacement;
  const language = importInfo.language;

  try {
    // Find migration documentation
    const migrationDocs = await findMigrationDocs(fromPackage, toPackage, language);

    // Get the ENTIRE file content for migration
    const originalCode = document.getText();

    // Generate migrated code for the entire file
    const { migratedCode, notes } = await generateMigratedCode(
      originalCode,
      fromPackage,
      toPackage,
      language,
      migrationDocs.content || 'No migration documentation available.'
    );

    // Create a range covering the entire document
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      document.lineAt(document.lineCount - 1).range.end
    );

    return {
      originalPackage: fromPackage,
      replacementPackage: toPackage,
      originalCode,
      migratedCode,
      range: fullRange,
      fileUri: importInfo.fileUri,
      documentationUrls: migrationDocs.urls,
      notes,
      hasMigrationDocs: migrationDocs.found,
    };
  } catch (error) {
    logError(`Failed to generate migration for ${fromPackage}`, error as Error);
    throw error;
  }
}
