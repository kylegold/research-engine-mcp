import { SourcePlugin, ExportPlugin } from './types.js';
import { logger as rootLogger } from '../utils/logger.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = rootLogger.child({ module: 'PluginRegistry' });

/**
 * Production-ready plugin registry with dynamic loading
 * Following Chief Architect's patterns
 */
export class PluginRegistry {
  private sourcePlugins = new Map<string, SourcePlugin>();
  private exportPlugins = new Map<string, ExportPlugin>();
  private pluginStats = new Map<string, PluginStats>();
  private initialized = false;

  /**
   * Initialize registry and load all plugins
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Plugin registry already initialized');
      return;
    }

    logger.info('Initializing plugin registry');
    
    try {
      // Load built-in plugins
      await this.loadBuiltInPlugins();
      
      // Load custom plugins from plugins directory
      await this.loadCustomPlugins();
      
      this.initialized = true;
      logger.info(
        {
          sourcePlugins: this.sourcePlugins.size,
          exportPlugins: this.exportPlugins.size
        },
        'Plugin registry initialized'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize plugin registry');
      throw error;
    }
  }

  /**
   * Load built-in plugins
   */
  private async loadBuiltInPlugins(): Promise<void> {
    const builtInDir = join(__dirname, 'sources');
    const exportDir = join(__dirname, 'exports');
    
    // Load source plugins
    try {
      const sourceFiles = await fs.readdir(builtInDir);
      for (const file of sourceFiles) {
        if (file.endsWith('.js') && !file.includes('.test.')) {
          await this.loadPlugin(join(builtInDir, file), 'source');
        }
      }
    } catch (error) {
      logger.warn({ error }, 'No built-in source plugins found');
    }
    
    // Load export plugins
    try {
      const exportFiles = await fs.readdir(exportDir);
      for (const file of exportFiles) {
        if (file.endsWith('.js') && !file.includes('.test.')) {
          await this.loadPlugin(join(exportDir, file), 'export');
        }
      }
    } catch (error) {
      logger.warn({ error }, 'No built-in export plugins found');
    }
  }

  /**
   * Load custom plugins from user directory
   */
  private async loadCustomPlugins(): Promise<void> {
    const customDir = process.env.PLUGIN_DIR || join(process.cwd(), 'plugins');
    
    try {
      const files = await fs.readdir(customDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
          await this.loadPlugin(join(customDir, file));
        }
      }
    } catch (error) {
      logger.info('No custom plugins directory found');
    }
  }

  /**
   * Load a single plugin file
   */
  private async loadPlugin(
    filePath: string, 
    type?: 'source' | 'export'
  ): Promise<void> {
    try {
      logger.debug({ filePath }, 'Loading plugin');
      
      // Dynamic import
      const module = await import(filePath);
      const moduleKeys = Object.keys(module);
      const firstKey = moduleKeys[0];
      const PluginClass = module.default || (firstKey ? module[firstKey] : null);
      
      if (!PluginClass) {
        logger.warn({ filePath }, 'No default export found in plugin file');
        return;
      }
      
      // Create instance
      const plugin = new PluginClass();
      
      // Detect type if not specified
      if (!type) {
        if ('search' in plugin) {
          type = 'source';
        } else if ('export' in plugin) {
          type = 'export';
        } else {
          logger.warn({ filePath }, 'Could not determine plugin type');
          return;
        }
      }
      
      // Register plugin
      if (type === 'source') {
        this.registerSourcePlugin(plugin as SourcePlugin);
      } else {
        this.registerExportPlugin(plugin as ExportPlugin);
      }
      
      // Initialize if needed
      if (plugin.initialize) {
        const config = this.getPluginConfig(plugin.id);
        await plugin.initialize(config);
      }
      
      logger.info(
        { pluginId: plugin.id, pluginName: plugin.name, type },
        'Plugin loaded successfully'
      );
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to load plugin');
    }
  }

  /**
   * Register a source plugin
   */
  registerSourcePlugin(plugin: SourcePlugin): void {
    if (this.sourcePlugins.has(plugin.id)) {
      logger.warn({ pluginId: plugin.id }, 'Source plugin already registered');
      return;
    }
    
    this.sourcePlugins.set(plugin.id, plugin);
    this.pluginStats.set(plugin.id, {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      avgDuration: 0,
      lastError: null
    });
    
    logger.info({ pluginId: plugin.id }, 'Source plugin registered');
  }

  /**
   * Register an export plugin
   */
  registerExportPlugin(plugin: ExportPlugin): void {
    if (this.exportPlugins.has(plugin.id)) {
      logger.warn({ pluginId: plugin.id }, 'Export plugin already registered');
      return;
    }
    
    this.exportPlugins.set(plugin.id, plugin);
    this.pluginStats.set(plugin.id, {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      avgDuration: 0,
      lastError: null
    });
    
    logger.info({ pluginId: plugin.id }, 'Export plugin registered');
  }

  /**
   * Get all source plugins that support a query
   */
  getSourcePluginsForQuery(query: string, context: any): SourcePlugin[] {
    const supportedPlugins: SourcePlugin[] = [];
    
    for (const plugin of this.sourcePlugins.values()) {
      try {
        if (plugin.supports(query, context)) {
          supportedPlugins.push(plugin);
        }
      } catch (error) {
        logger.error(
          { error, pluginId: plugin.id },
          'Error checking plugin support'
        );
      }
    }
    
    logger.info(
      { query, supportedCount: supportedPlugins.length },
      'Found supported plugins for query'
    );
    
    return supportedPlugins;
  }

  /**
   * Get export plugin by format
   */
  getExportPlugin(format: string): ExportPlugin | undefined {
    for (const plugin of this.exportPlugins.values()) {
      if (plugin.format === format) {
        return plugin;
      }
    }
    return undefined;
  }

  /**
   * Get all registered source plugins
   */
  getAllSourcePlugins(): SourcePlugin[] {
    return Array.from(this.sourcePlugins.values());
  }

  /**
   * Get all registered export plugins
   */
  getAllExportPlugins(): ExportPlugin[] {
    return Array.from(this.exportPlugins.values());
  }

  /**
   * Update plugin statistics
   */
  updateStats(
    pluginId: string, 
    success: boolean, 
    duration: number,
    error?: Error
  ): void {
    const stats = this.pluginStats.get(pluginId);
    if (!stats) return;
    
    stats.totalCalls++;
    if (success) {
      stats.successfulCalls++;
    } else {
      stats.failedCalls++;
      stats.lastError = error?.message || 'Unknown error';
    }
    
    // Update rolling average
    stats.avgDuration = 
      (stats.avgDuration * (stats.totalCalls - 1) + duration) / stats.totalCalls;
  }

  /**
   * Get plugin statistics
   */
  getStats(pluginId: string): PluginStats | undefined {
    return this.pluginStats.get(pluginId);
  }

  /**
   * Get all plugin statistics
   */
  getAllStats(): Record<string, PluginStats> {
    const allStats: Record<string, PluginStats> = {};
    for (const [id, stats] of this.pluginStats.entries()) {
      allStats[id] = stats;
    }
    return allStats;
  }

  /**
   * Get plugin configuration from environment
   */
  private getPluginConfig(pluginId: string): Record<string, any> {
    const config: Record<string, any> = {};
    const prefix = `PLUGIN_${pluginId.toUpperCase()}_`;
    
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix)) {
        const configKey = key.substring(prefix.length).toLowerCase();
        config[configKey] = value;
      }
    }
    
    return config;
  }

  /**
   * Dispose all plugins
   */
  async dispose(): Promise<void> {
    logger.info('Disposing plugin registry');
    
    // Dispose source plugins
    for (const plugin of this.sourcePlugins.values()) {
      if (plugin.dispose) {
        try {
          await plugin.dispose();
        } catch (error) {
          logger.error({ error, pluginId: plugin.id }, 'Error disposing plugin');
        }
      }
    }
    
    // Clear collections
    this.sourcePlugins.clear();
    this.exportPlugins.clear();
    this.pluginStats.clear();
    this.initialized = false;
  }
}

interface PluginStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgDuration: number;
  lastError: string | null;
}

// Singleton instance
export const pluginRegistry = new PluginRegistry();