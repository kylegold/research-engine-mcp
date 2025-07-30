import pRetry from 'p-retry';
import { logger } from './logger.js';

export interface RetryOptions {
  retries?: number;
  factor?: number;
  minTimeout?: number;
  maxTimeout?: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  retries: 5,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 30000
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  
  return pRetry(fn, {
    retries: opts.retries!,
    factor: opts.factor!,
    minTimeout: opts.minTimeout!,
    maxTimeout: opts.maxTimeout!,
    onFailedAttempt: (error) => {
      logger.warn({
        error: error.message,
        attempt: error.attemptNumber,
        retriesLeft: error.retriesLeft
      }, 'Retry attempt failed');
    }
  });
}

export function isRateLimitError(error: any): boolean {
  return (
    error.status === 429 ||
    error.code === 'rate_limit_exceeded' ||
    error.message?.toLowerCase().includes('rate limit')
  );
}

export function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // HTTP errors that are retryable
  if (error.status >= 500 || error.status === 429) {
    return true;
  }
  
  // OpenAI specific
  if (error.code === 'rate_limit_exceeded' || error.code === 'server_error') {
    return true;
  }
  
  return false;
}