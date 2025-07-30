import { BaseSourcePlugin } from '../base.js';
import { PluginContext, PluginResult, QueryContext } from '../types.js';

/**
 * Auto plugin that delegates to all available source plugins
 * Used when no specific sources are requested
 */
export class AutoSourcePlugin extends BaseSourcePlugin {
  id = 'auto';
  name = 'Auto Search';
  description = 'Automatically searches all available sources';
  version = '1.0.0';

  /**
   * Always supports queries when no specific sources are requested
   */
  supports(_query: string, context: QueryContext): boolean {
    // Only activate if no specific sources are requested
    return !context.preferences?.sources || context.preferences.sources.length === 0;
  }

  /**
   * This plugin doesn't search directly - the orchestrator handles delegation
   */
  protected async doSearch(_context: PluginContext): Promise<PluginResult> {
    // This is a meta-plugin that signals the orchestrator to use all plugins
    return {
      success: true,
      documents: [],
      metadata: {
        source: this.id,
        documentsFound: 0,
        duration: 0,
        cached: false
      }
    };
  }
}

export default AutoSourcePlugin;