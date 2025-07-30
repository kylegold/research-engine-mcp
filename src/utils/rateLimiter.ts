import Bottleneck from 'bottleneck';
import { logger } from './logger.js';

// GitHub rate limiter (5000 requests/hour for authenticated requests)
export const githubLimiter = new Bottleneck({
  reservoir: 4500, // Leave some buffer
  reservoirRefreshInterval: 60 * 60 * 1000, // 1 hour
  reservoirRefreshAmount: 4500,
  maxConcurrent: 2,
  minTime: 200 // Max 5 requests per second
});

githubLimiter.on('error', (error) => {
  logger.error({ error }, 'GitHub rate limiter error');
});

githubLimiter.on('depleted', () => {
  logger.warn('GitHub rate limit depleted, requests will be queued');
});

// Reddit rate limiter (60 requests/minute)
export const redditLimiter = new Bottleneck({
  reservoir: 60,
  reservoirRefreshInterval: 60 * 1000, // 1 minute
  reservoirRefreshAmount: 60,
  maxConcurrent: 1,
  minTime: 1000 // Max 1 request per second
});

redditLimiter.on('error', (error) => {
  logger.error({ error }, 'Reddit rate limiter error');
});

// OpenAI rate limiter (adjust based on your tier)
export const openAILimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200 // Max 5 requests per second
});

// Notion rate limiter (3 requests/second)
export const notionLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 334 // ~3 requests per second
});