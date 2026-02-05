import * as vscode from 'vscode';
import { DeprecationInfo } from '../models/index.js';
import { getCacheTtlMs, logInfo, logDebug } from '../utils/index.js';

interface CacheEntry {
  data: DeprecationInfo;
  timestamp: number;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

const CACHE_KEY = 'darwin.deprecationCache';

let extensionContext: vscode.ExtensionContext | null = null;

/**
 * Initialize the cache service with the extension context
 */
export function initCacheService(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/**
 * Generate a cache key for a package
 */
function getCacheKey(packageName: string, language: string): string {
  return `${language}:${packageName}`;
}

/**
 * Get the cache store from global state
 */
function getCacheStore(): CacheStore {
  if (!extensionContext) {
    return {};
  }
  return extensionContext.globalState.get<CacheStore>(CACHE_KEY, {});
}

/**
 * Save the cache store to global state
 */
async function saveCacheStore(store: CacheStore): Promise<void> {
  if (!extensionContext) {
    return;
  }
  await extensionContext.globalState.update(CACHE_KEY, store);
}

/**
 * Check if a cache entry is still valid
 */
function isEntryValid(entry: CacheEntry): boolean {
  const ttl = getCacheTtlMs();
  const age = Date.now() - entry.timestamp;
  return age < ttl;
}

/**
 * Get cached deprecation info for a package
 */
export function getCachedDeprecation(
  packageName: string,
  language: string
): DeprecationInfo | null {
  const store = getCacheStore();
  const key = getCacheKey(packageName, language);
  const entry = store[key];

  if (!entry) {
    logDebug(`Cache miss for ${key}`);
    return null;
  }

  if (!isEntryValid(entry)) {
    logDebug(`Cache expired for ${key}`);
    return null;
  }

  logDebug(`Cache hit for ${key}`);
  return entry.data;
}

/**
 * Cache deprecation info for a package
 */
export async function cacheDeprecation(info: DeprecationInfo): Promise<void> {
  const store = getCacheStore();
  const key = getCacheKey(info.packageName, info.language);

  store[key] = {
    data: {
      ...info,
      cachedAt: Date.now(),
    },
    timestamp: Date.now(),
  };

  await saveCacheStore(store);
  logDebug(`Cached deprecation info for ${key}`);
}

/**
 * Remove a package from the cache
 */
export async function removeCachedDeprecation(
  packageName: string,
  language: string
): Promise<void> {
  const store = getCacheStore();
  const key = getCacheKey(packageName, language);

  if (store[key]) {
    delete store[key];
    await saveCacheStore(store);
    logDebug(`Removed cache entry for ${key}`);
  }
}

/**
 * Clear all cached deprecation info
 */
export async function clearCache(): Promise<number> {
  const store = getCacheStore();
  const count = Object.keys(store).length;

  await saveCacheStore({});
  logInfo(`Cleared ${count} cached entries`);

  return count;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { total: number; valid: number; expired: number } {
  const store = getCacheStore();
  const entries = Object.values(store);

  let valid = 0;
  let expired = 0;

  for (const entry of entries) {
    if (isEntryValid(entry)) {
      valid++;
    } else {
      expired++;
    }
  }

  return {
    total: entries.length,
    valid,
    expired,
  };
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredEntries(): Promise<number> {
  const store = getCacheStore();
  const keys = Object.keys(store);
  let removed = 0;

  for (const key of keys) {
    if (!isEntryValid(store[key])) {
      delete store[key];
      removed++;
    }
  }

  if (removed > 0) {
    await saveCacheStore(store);
    logInfo(`Cleaned up ${removed} expired cache entries`);
  }

  return removed;
}
