import * as vscode from 'vscode';
import { ImportInfo, DeprecationInfo } from './index.js';

/**
 * Represents a single usage of an imported name
 */
export interface UsageLocation {
  /** Range in the document where this usage occurs */
  range: vscode.Range;

  /** The identifier being used (e.g., 'requests', 'get', 'Session') */
  identifier: string;

  /** Type of usage */
  usageType: 'function_call' | 'attribute_access' | 'class_instantiation' | 'reference';
}

/**
 * Tracks where an import is used in the code
 */
export interface UsageInfo {
  /** The import this usage info is associated with */
  importInfo: ImportInfo;

  /** All places this import is used in the file */
  usageLocations: UsageLocation[];

  /** Deprecation info if available */
  deprecationInfo?: DeprecationInfo;
}

/**
 * Result of tracking usages in a file
 */
export interface UsageTrackingResult {
  /** All usage information for deprecated imports */
  usages: UsageInfo[];

  /** Total number of usage locations found */
  totalUsageCount: number;
}
