import { 
  SourcePlugin, 
  ExportPlugin, 
  PluginContext, 
  PluginResult,
  QueryContext,
  AnalysisResult,
  ExportContext,
  ExportResult,
  PluginError
} from './types.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { withCache } from '../utils/cache.js';

/**
 * Base class for source plugins with common functionality
 */
export abstract class BaseSourcePlugin implements SourcePlugin {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  version: string = '1.0.0';
  
  protected logger = logger.child({ plugin: this.constructor.name });
  protected initialized = false;
  
  /**
   * Default implementation - override for custom logic
   */
  supports(_query: string, _context: QueryContext): boolean {
    // By default, support all queries
    return true;
  }
  
  /**
   * Wrapper method that handles common concerns
   */
  async search(context: PluginContext): Promise<PluginResult> {
    const startTime = Date.now();
    this.logger.info({ query: context.query }, `Starting ${this.name} search`);
    
    try {
      // Check cache first
      const cacheKey = this.getCacheKey(context);
      const cached = await this.checkCache(cacheKey);
      if (cached) {
        this.logger.info('Returning cached results');
        return {
          ...cached,
          metadata: { ...cached.metadata, cached: true }
        };
      }
      
      // Execute actual search with retry
      const result = await withRetry(
        () => this.doSearch(context),
        { retries: 3, minTimeout: 1000 }
      );
      
      // Cache successful results
      if (result.success) {
        await this.cacheResult(cacheKey, result);
      }
      
      // Add timing metadata
      result.metadata.duration = Date.now() - startTime;
      
      this.logger.info(
        { documents: result.documents.length, duration: result.metadata.duration },
        `${this.name} search completed`
      );
      
      return result;
    } catch (error) {
      this.logger.error({ error }, `${this.name} search failed`);
      
      // Convert to plugin error
      const pluginError = this.handleError(error);
      
      return {
        success: false,
        documents: [],
        metadata: {
          source: this.id,
          documentsFound: 0,
          duration: Date.now() - startTime
        },
        error: pluginError
      };
    }
  }
  
  /**
   * Actual search implementation - must be provided by subclasses
   */
  protected abstract doSearch(context: PluginContext): Promise<PluginResult>;
  
  /**
   * Generate cache key for this search
   */
  protected getCacheKey(context: PluginContext): string {
    return `${this.id}:${context.query}:${context.depth || 'standard'}`;
  }
  
  /**
   * Check cache for existing results
   */
  protected async checkCache(key: string): Promise<PluginResult | null> {
    try {
      return await withCache(this.id, key, async () => null, 0);
    } catch {
      return null;
    }
  }
  
  /**
   * Cache successful results
   */
  protected async cacheResult(key: string, result: PluginResult): Promise<void> {
    const ttl = this.getCacheTTL();
    await withCache(this.id, key, async () => result, ttl);
  }
  
  /**
   * Get cache TTL in seconds - override for custom TTL
   */
  protected getCacheTTL(): number {
    return 3600; // 1 hour default
  }
  
  /**
   * Convert errors to plugin error format
   */
  protected handleError(error: any): PluginError {
    // Rate limit errors
    if (error.status === 429 || error.code === 'rate_limit') {
      return {
        code: 'TEMP_ERROR',
        message: `${this.name} rate limit exceeded`,
        retryIn: 300, // 5 minutes
        details: error
      };
    }
    
    // Network/timeout errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return {
        code: 'TEMP_ERROR',
        message: `${this.name} service unavailable`,
        retryIn: 60,
        details: error
      };
    }
    
    // Invalid query
    if (error.code === 'invalid_query' || error.status === 400) {
      return {
        code: 'USER_ERROR',
        message: error.message || 'Invalid search query',
        details: error
      };
    }
    
    // Default to permanent error
    return {
      code: 'PERM_ERROR',
      message: error.message || `${this.name} plugin error`,
      details: error
    };
  }
  
  async initialize?(_config: Record<string, any>): Promise<void> {
    this.initialized = true;
    this.logger.info(`${this.name} plugin initialized`);
  }
  
  async dispose?(): Promise<void> {
    this.initialized = false;
    this.logger.info(`${this.name} plugin disposed`);
  }
}

/**
 * Base class for export plugins
 */
export abstract class BaseExportPlugin implements ExportPlugin {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  abstract format: string;
  
  protected logger = logger.child({ plugin: this.constructor.name });
  
  /**
   * Wrapper method with common functionality
   */
  async export(
    analysis: AnalysisResult,
    context: ExportContext
  ): Promise<ExportResult> {
    const startTime = Date.now();
    this.logger.info({ format: this.format }, `Starting ${this.name} export`);
    
    try {
      // Validate configuration if needed
      if (this.validateConfig && !this.validateConfig(context.credentials || {})) {
        throw new Error('Invalid export configuration');
      }
      
      // Execute export
      const result = await this.doExport(analysis, context);
      
      this.logger.info(
        { duration: Date.now() - startTime, location: result.location },
        `${this.name} export completed`
      );
      
      return result;
    } catch (error) {
      this.logger.error({ error }, `${this.name} export failed`);
      
      return {
        success: false,
        format: this.format,
        error: error instanceof Error ? error.message : 'Export failed'
      };
    }
  }
  
  /**
   * Actual export implementation
   */
  protected abstract doExport(
    analysis: AnalysisResult,
    context: ExportContext
  ): Promise<ExportResult>;
  
  /**
   * Optional config validation
   */
  validateConfig?(_config: Record<string, any>): boolean {
    return true;
  }
}