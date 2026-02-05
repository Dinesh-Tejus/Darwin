/**
 * Information about a package's deprecation status
 */
export interface DeprecationInfo {
  /** The package name */
  packageName: string;

  /** Language of the package */
  language: 'python' | 'javascript' | 'typescript';

  /** Whether the package is deprecated */
  isDeprecated: boolean;

  /** Reason for deprecation */
  reason?: string;

  /** Recommended replacement package */
  replacement?: string;

  /** Confidence level of the deprecation assessment (0-1) */
  confidence: number;

  /** Source URLs where deprecation info was found */
  sources?: string[];

  /** Timestamp when this info was cached */
  cachedAt?: number;
}

/**
 * Raw search result from Tavily
 */
export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

/**
 * Gemini's analysis of deprecation status
 */
export interface GeminiDeprecationAnalysis {
  isDeprecated: boolean;
  reason: string;
  replacement: string | null;
  confidence: number;
}
