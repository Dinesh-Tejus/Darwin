import * as vscode from 'vscode';

/**
 * Custom replacement mapping type
 */
export type CustomReplacements = Record<string, string>;

/**
 * Darwin extension configuration interface
 */
export interface DarwinConfig {
  tavilyApiKey: string;
  geminiApiKey: string;
  geminiModel: 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-2.0-flash' | 'gemini-flash-latest';
  cacheTtlMonths: number;
  ignoredPackages: string[];
  enabledLanguages: string[];
  confidenceThreshold: number;
  customReplacements: CustomReplacements;
  showLowConfidenceWarnings: boolean;
  maxMigrationHistorySize: number;
}

/**
 * Get the Darwin extension configuration
 */
export function getConfig(): DarwinConfig {
  const config = vscode.workspace.getConfiguration('darwin');

  return {
    tavilyApiKey: config.get<string>('tavilyApiKey', ''),
    geminiApiKey: config.get<string>('geminiApiKey', ''),
    geminiModel: config.get<'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-2.0-flash' | 'gemini-flash-latest'>('geminiModel', 'gemini-2.0-flash'),
    cacheTtlMonths: config.get<number>('cacheTtlMonths', 2),
    ignoredPackages: config.get<string[]>('ignoredPackages', []),
    enabledLanguages: config.get<string[]>('enabledLanguages', [
      'python',
      'javascript',
      'typescript',
      'javascriptreact',
      'typescriptreact',
    ]),
    confidenceThreshold: config.get<number>('confidenceThreshold', 0.8),
    customReplacements: config.get<CustomReplacements>('customReplacements', {}),
    showLowConfidenceWarnings: config.get<boolean>('showLowConfidenceWarnings', true),
    maxMigrationHistorySize: config.get<number>('maxMigrationHistorySize', 10),
  };
}

/**
 * Get custom replacement for a package if configured
 */
export function getCustomReplacement(packageName: string): string | undefined {
  const config = getConfig();
  return config.customReplacements[packageName];
}

/**
 * Check if deprecation confidence meets the threshold
 */
export function meetsConfidenceThreshold(confidence: number): boolean {
  const config = getConfig();
  return confidence >= config.confidenceThreshold;
}

/**
 * Get confidence threshold
 */
export function getConfidenceThreshold(): number {
  return getConfig().confidenceThreshold;
}

/**
 * Check if a package is in the ignore list
 */
export function isPackageIgnored(packageName: string): boolean {
  const config = getConfig();
  return config.ignoredPackages.includes(packageName);
}

/**
 * Check if a language is enabled for scanning
 */
export function isLanguageEnabled(languageId: string): boolean {
  const config = getConfig();
  return config.enabledLanguages.includes(languageId);
}

/**
 * Add a package to the ignore list
 */
export async function addToIgnoreList(packageName: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('darwin');
  const ignoredPackages = config.get<string[]>('ignoredPackages', []);

  if (!ignoredPackages.includes(packageName)) {
    ignoredPackages.push(packageName);
    await config.update('ignoredPackages', ignoredPackages, vscode.ConfigurationTarget.Global);
  }
}

/**
 * Validate that required API keys are configured
 */
export function validateApiKeys(): { valid: boolean; missing: string[] } {
  const config = getConfig();
  const missing: string[] = [];

  if (!config.tavilyApiKey) {
    missing.push('Tavily API Key (darwin.tavilyApiKey)');
  }

  if (!config.geminiApiKey) {
    missing.push('Gemini API Key (darwin.geminiApiKey)');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get cache TTL in milliseconds
 */
export function getCacheTtlMs(): number {
  const config = getConfig();
  // Convert months to milliseconds
  return config.cacheTtlMonths * 30 * 24 * 60 * 60 * 1000;
}
