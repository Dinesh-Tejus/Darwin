import * as vscode from 'vscode';
import { ImportInfo, DeprecationInfo, UsageInfo } from '../models/index.js';
import { logInfo, meetsConfidenceThreshold, getConfig } from '../utils/index.js';

// Diagnostic collection for Darwin
let diagnosticCollection: vscode.DiagnosticCollection | null = null;

// Store deprecation info for diagnostics (for code actions to retrieve)
const deprecationDataMap = new Map<string, DeprecationInfo>();

/**
 * Initialize the diagnostics provider
 */
export function initDiagnosticsProvider(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  if (!diagnosticCollection) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('darwin');
    context.subscriptions.push(diagnosticCollection);
  }
  return diagnosticCollection;
}

/**
 * Get the diagnostic collection
 */
export function getDiagnosticCollection(): vscode.DiagnosticCollection {
  if (!diagnosticCollection) {
    throw new Error('Diagnostics provider not initialized');
  }
  return diagnosticCollection;
}

/**
 * Create a diagnostic for a deprecated import
 */
export function createDiagnostic(
  importInfo: ImportInfo,
  deprecationInfo: DeprecationInfo
): vscode.Diagnostic {
  const confidencePercent = Math.round(deprecationInfo.confidence * 100);
  let message = `"${deprecationInfo.packageName}" is deprecated`;

  if (deprecationInfo.reason) {
    message += `: ${deprecationInfo.reason}`;
  }

  if (deprecationInfo.replacement) {
    message += `. Recommended replacement: ${deprecationInfo.replacement}`;
  }

  // Add confidence info
  message += ` (${confidencePercent}% confidence)`;

  // Use Warning for high confidence, Hint for low confidence
  const severity = meetsConfidenceThreshold(deprecationInfo.confidence)
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Hint;

  const diagnostic = new vscode.Diagnostic(
    importInfo.range,
    message,
    severity
  );

  diagnostic.source = 'Darwin';

  // Store the package name in the code for retrieval by code actions
  diagnostic.code = {
    value: deprecationInfo.packageName,
    target: vscode.Uri.parse(
      `darwin:deprecation/${encodeURIComponent(deprecationInfo.packageName)}`
    ),
  };

  // Add deprecated tag for VS Code UI
  diagnostic.tags = [vscode.DiagnosticTag.Deprecated];

  // Add related information if sources are available
  if (deprecationInfo.sources && deprecationInfo.sources.length > 0) {
    diagnostic.relatedInformation = deprecationInfo.sources.slice(0, 3).map(
      (url) =>
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(
            vscode.Uri.parse(url),
            new vscode.Position(0, 0)
          ),
          'Deprecation source'
        )
    );
  }

  return diagnostic;
}

/**
 * Set diagnostics for a document
 */
export function setDiagnostics(
  uri: vscode.Uri,
  imports: ImportInfo[],
  deprecations: Map<string, DeprecationInfo>
): void {
  const collection = getDiagnosticCollection();
  const diagnostics: vscode.Diagnostic[] = [];

  for (const importInfo of imports) {
    const deprecationInfo = deprecations.get(importInfo.packageName);
    if (deprecationInfo && deprecationInfo.isDeprecated) {
      const diagnostic = createDiagnostic(importInfo, deprecationInfo);
      diagnostics.push(diagnostic);

      // Store deprecation info for code actions
      storeDeprecationData(importInfo.packageName, deprecationInfo);
    }
  }

  collection.set(uri, diagnostics);
  logInfo(`Set ${diagnostics.length} diagnostics for ${uri.fsPath}`);
}

/**
 * Clear diagnostics for a document
 */
export function clearDiagnostics(uri: vscode.Uri): void {
  const collection = getDiagnosticCollection();
  collection.delete(uri);
}

/**
 * Clear all diagnostics
 */
export function clearAllDiagnostics(): void {
  const collection = getDiagnosticCollection();
  collection.clear();
  deprecationDataMap.clear();
}

/**
 * Store deprecation data for later retrieval
 */
export function storeDeprecationData(packageName: string, info: DeprecationInfo): void {
  deprecationDataMap.set(packageName, info);
}

/**
 * Get stored deprecation data
 */
export function getDeprecationData(packageName: string): DeprecationInfo | undefined {
  return deprecationDataMap.get(packageName);
}

/**
 * Get package name from a diagnostic
 */
export function getPackageNameFromDiagnostic(diagnostic: vscode.Diagnostic): string | undefined {
  if (diagnostic.code && typeof diagnostic.code === 'object' && 'value' in diagnostic.code) {
    return diagnostic.code.value as string;
  }
  return undefined;
}

/**
 * Create a diagnostic for a usage location
 */
export function createUsageDiagnostic(
  usage: UsageInfo,
  usageRange: vscode.Range,
  importDiagnostic: vscode.Diagnostic
): vscode.Diagnostic {
  const deprecationInfo = usage.deprecationInfo;
  const packageName = usage.importInfo.packageName;

  let message = `Usage of deprecated package "${packageName}"`;

  if (deprecationInfo?.replacement) {
    message += ` - consider using "${deprecationInfo.replacement}"`;
  }

  const diagnostic = new vscode.Diagnostic(
    usageRange,
    message,
    vscode.DiagnosticSeverity.Hint // Use Hint for usages (less intrusive than Warning)
  );

  diagnostic.source = 'Darwin';

  // Store the package name in the code for retrieval by code actions
  diagnostic.code = {
    value: packageName,
    target: vscode.Uri.parse(
      `darwin:deprecation/${encodeURIComponent(packageName)}`
    ),
  };

  // Link back to the import statement
  diagnostic.relatedInformation = [
    new vscode.DiagnosticRelatedInformation(
      new vscode.Location(usage.importInfo.fileUri, usage.importInfo.range),
      `Import of "${packageName}" is deprecated`
    ),
  ];

  // Add tags to indicate deprecated
  diagnostic.tags = [vscode.DiagnosticTag.Deprecated];

  return diagnostic;
}

/**
 * Set diagnostics for a document including usage locations
 */
export function setDiagnosticsWithUsages(
  uri: vscode.Uri,
  usages: UsageInfo[]
): void {
  const collection = getDiagnosticCollection();
  const diagnostics: vscode.Diagnostic[] = [];

  for (const usage of usages) {
    const deprecationInfo = usage.deprecationInfo;
    if (!deprecationInfo || !deprecationInfo.isDeprecated) {
      continue;
    }

    // Create diagnostic for the import
    const importDiagnostic = createDiagnostic(usage.importInfo, deprecationInfo);

    // Add related information for all usages
    const usageLocations = usage.usageLocations.map(
      (loc) =>
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(uri, loc.range),
          `Used here (${loc.usageType.replace('_', ' ')})`
        )
    );

    if (usageLocations.length > 0) {
      importDiagnostic.relatedInformation = [
        ...(importDiagnostic.relatedInformation || []),
        ...usageLocations,
      ];
    }

    diagnostics.push(importDiagnostic);

    // Create diagnostics for each usage location
    for (const location of usage.usageLocations) {
      const usageDiagnostic = createUsageDiagnostic(
        usage,
        location.range,
        importDiagnostic
      );
      diagnostics.push(usageDiagnostic);
    }
  }

  collection.set(uri, diagnostics);
  logInfo(
    `Set ${diagnostics.length} diagnostics (including usages) for ${uri.fsPath}`
  );
}
