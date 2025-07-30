import { createHash } from 'crypto';
import { logger } from './logger.js';

// Simple in-memory cache as we no longer use Redis
const memoryCache = new Map<string, { value: any; expires: number }>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const cached = memoryCache.get(key);
    if (cached && cached.expires > Date.now()) {
      logger.debug({ key }, 'Cache hit');
      return cached.value;
    }
    return null;
  } catch (error) {
    logger.error({ error, key }, 'Cache get error');
    return null;
  }
}

export async function cacheSet(key: string, value: any, ttl: number = 86400): Promise<void> {
  try {
    memoryCache.set(key, {
      value,
      expires: Date.now() + (ttl * 1000)
    });
    logger.debug({ key, ttl }, 'Cache set');
  } catch (error) {
    logger.error({ error, key }, 'Cache set error');
  }
}

export function createCacheKey(prefix: string, data: any): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .substring(0, 16);
  return `${prefix}:${hash}`;
}

export async function withCache<T>(
  prefix: string,
  data: any,
  fn: () => Promise<T>,
  ttl: number = 86400
): Promise<T> {
  const key = createCacheKey(prefix, data);
  
  // Check cache
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  // Execute function
  const result = await fn();
  
  // Store in cache
  await cacheSet(key, result, ttl);
  
  return result;
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expires < now) {
      memoryCache.delete(key);
    }
  }
}, 60000); // Every minute