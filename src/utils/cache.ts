import Redis from 'ioredis';
import { createHash } from 'crypto';
import { logger } from './logger.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const cached = await redis.get(key);
    if (cached) {
      logger.debug({ key }, 'Cache hit');
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    logger.error({ error, key }, 'Cache get error');
    return null;
  }
}

export async function cacheSet(key: string, value: any, ttl: number = 86400): Promise<void> {
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
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