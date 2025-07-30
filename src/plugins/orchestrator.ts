import { 
  SourcePlugin, 
  PluginContext, 
  PluginExecutionResult,
  PluginStatus,
  QueryContext,
  AnalysisResult,
  ExportContext,
  Document,
  Insight
} from './types.js';
import { pluginRegistry } from './registry.js';
import { logger as rootLogger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import pLimit from 'p-limit';

const logger = rootLogger.child({ module: 'PluginOrchestrator' });

/**
 * Orchestrates plugin execution with production-grade patterns
 */
export class PluginOrchestrator extends EventEmitter {
  private concurrencyLimit: (fn: () => Promise<any>) => Promise<any>;
  
  constructor(maxConcurrency = 5) {
    super();
    this.concurrencyLimit = pLimit(maxConcurrency);
  }

  /**
   * Execute research with automatic plugin selection
   */
  async executeResearch(
    query: string,
    context: QueryContext,
    jobId: string
  ): Promise<ResearchResult> {
    const startTime = Date.now();
    logger.info({ query, jobId }, 'Starting research execution');
    
    // Initialize progress tracking
    const progress = new ProgressTracker(jobId);
    this.emit('progress', progress.getState());
    
    try {
      // Phase 1: Plugin Discovery (5% progress)
      progress.updatePhase('plugin_discovery', 'Discovering relevant sources...');
      this.emit('progress', progress.getState());
      
      const sourcePlugins = pluginRegistry.getSourcePluginsForQuery(query, context);
      
      if (sourcePlugins.length === 0) {
        throw new Error('No plugins available for this query');
      }
      
      progress.completePhase('plugin_discovery');
      this.emit('progress', progress.getState());
      
      // Phase 2: Data Collection (40% progress)
      progress.updatePhase('data_collection', `Searching ${sourcePlugins.length} sources...`);
      this.emit('progress', progress.getState());
      
      const pluginResults = await this.executeSourcePlugins(
        sourcePlugins,
        query,
        context,
        jobId,
        progress
      );
      
      progress.completePhase('data_collection');
      this.emit('progress', progress.getState());
      
      // Phase 3: Analysis (40% progress)
      progress.updatePhase('analysis', 'Analyzing collected documents...');
      this.emit('progress', progress.getState());
      
      const analysis = await this.analyzeDocuments(
        pluginResults,
        query,
        context,
        progress
      );
      
      progress.completePhase('analysis');
      this.emit('progress', progress.getState());
      
      // Phase 4: Export (15% progress)
      if (context.preferences?.exportFormat) {
        progress.updatePhase('export', 'Exporting results...');
        this.emit('progress', progress.getState());
        
        await this.exportResults(analysis, context);
        
        progress.completePhase('export');
      }
      
      progress.complete();
      this.emit('progress', progress.getState());
      
      const duration = Date.now() - startTime;
      logger.info(
        { 
          jobId, 
          duration, 
          documentsFound: analysis.metadata.totalDocuments,
          pluginsUsed: pluginResults.length 
        },
        'Research execution completed'
      );
      
      return {
        success: true,
        analysis,
        pluginResults,
        metadata: {
          duration,
          pluginsUsed: sourcePlugins.map(p => p.id),
          totalDocuments: analysis.metadata.totalDocuments
        }
      };
    } catch (error) {
      progress.fail(error instanceof Error ? error.message : 'Unknown error');
      this.emit('progress', progress.getState());
      
      logger.error({ error, jobId }, 'Research execution failed');
      throw error;
    }
  }

  /**
   * Execute source plugins with concurrency control
   */
  private async executeSourcePlugins(
    plugins: SourcePlugin[],
    query: string,
    context: QueryContext,
    jobId: string,
    progress: ProgressTracker
  ): Promise<PluginExecutionResult[]> {
    const results: PluginExecutionResult[] = [];
    const pluginWeight = 40 / plugins.length; // Distribute progress weight
    
    const pluginPromises = plugins.map(plugin => 
      this.concurrencyLimit(async () => {
        const result = await this.executeSourcePlugin(
          plugin,
          query,
          context,
          jobId,
          async (message, percent) => {
            progress.updatePlugin(plugin.id, message, percent);
            this.emit('progress', progress.getState());
          }
        );
        
        // Update progress for this plugin
        progress.addProgress(pluginWeight);
        this.emit('progress', progress.getState());
        
        return result;
      })
    );
    
    // Execute with partial failure tolerance
    const settled = await Promise.allSettled(pluginPromises);
    
    for (let i = 0; i < settled.length; i++) {
      const settledResult = settled[i];
      const plugin = plugins[i];
      
      if (!settledResult || !plugin) continue;
      
      if (settledResult.status === 'fulfilled') {
        results.push(settledResult.value);
      } else {
        logger.error(
          { error: settledResult.reason, pluginId: plugin.id },
          'Plugin execution failed'
        );
        
        results.push({
          pluginId: plugin.id,
          status: PluginStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          error: {
            code: 'PERM_ERROR',
            message: settledResult.reason?.message || 'Plugin execution failed'
          }
        });
      }
    }
    
    return results;
  }

  /**
   * Execute a single source plugin with error isolation
   */
  private async executeSourcePlugin(
    plugin: SourcePlugin,
    query: string,
    context: QueryContext,
    jobId: string,
    updateProgress: (message: string, percent?: number) => Promise<void>
  ): Promise<PluginExecutionResult> {
    const startTime = new Date();
    const pluginContext: PluginContext = {
      ...context,
      query,
      jobId,
      logger: logger.child({ plugin: plugin.id }),
      cache: {}, // TODO: Implement cache
      config: {},
      updateProgress
    };
    
    try {
      logger.info({ pluginId: plugin.id }, 'Executing source plugin');
      
      const result = await plugin.search(pluginContext);
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      // Update registry stats
      pluginRegistry.updateStats(plugin.id, result.success, duration);
      
      return {
        pluginId: plugin.id,
        status: result.success ? PluginStatus.COMPLETED : PluginStatus.FAILED,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration,
        result,
        error: result.error
      };
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      // Update registry stats
      pluginRegistry.updateStats(
        plugin.id, 
        false, 
        duration, 
        error instanceof Error ? error : new Error('Unknown error')
      );
      
      return {
        pluginId: plugin.id,
        status: PluginStatus.FAILED,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration,
        error: {
          code: 'PERM_ERROR',
          message: error instanceof Error ? error.message : 'Plugin execution failed',
          details: error
        }
      };
    }
  }

  /**
   * Analyze collected documents
   */
  private async analyzeDocuments(
    pluginResults: PluginExecutionResult[],
    query: string,
    context: QueryContext,
    progress: ProgressTracker
  ): Promise<AnalysisResult> {
    // Collect all successful documents
    const allDocuments: Document[] = [];
    
    for (const result of pluginResults) {
      if (result.status === PluginStatus.COMPLETED && result.result?.documents) {
        allDocuments.push(...result.result.documents);
      }
    }
    
    if (allDocuments.length === 0) {
      throw new Error('No documents collected from any source');
    }
    
    logger.info(
      { documentCount: allDocuments.length },
      'Analyzing collected documents'
    );
    
    // Use AI analyzer if available, otherwise fallback to basic analysis
    try {
      if (process.env.OPENAI_API_KEY) {
        progress.updatePhase('analysis', 'Performing AI analysis...');
        
        const { AIAnalyzer } = await import('../analysis/analyzer.js');
        const analyzer = new AIAnalyzer();
        
        return await analyzer.analyze(
          allDocuments,
          query,
          context.depth || 'standard'
        );
      }
    } catch (error) {
      logger.warn({ error }, 'AI analysis failed, using fallback');
    }
    
    // Fallback to basic analysis
    return {
      id: `analysis-${Date.now()}`,
      query,
      summary: `Analysis of ${allDocuments.length} documents for query: "${query}"`,
      insights: this.generateBasicInsights(allDocuments, query),
      recommendations: this.generateBasicRecommendations(allDocuments, query),
      sources: allDocuments.slice(0, 10), // Top 10 documents
      metadata: {
        totalDocuments: allDocuments.length,
        analysisDuration: 0,
        confidence: 0.5,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Generate basic insights without AI
   */
  private generateBasicInsights(documents: Document[], query: string): Insight[] {
    const insights: Insight[] = [];
    
    // Source diversity insight
    const sources = new Set(documents.map(d => d.metadata.source));
    if (sources.size > 1) {
      insights.push({
        id: 'insight-sources',
        category: 'fact',
        title: 'Multiple Sources Consulted',
        description: `Found relevant information across ${sources.size} different sources: ${Array.from(sources).join(', ')}`,
        importance: 'medium',
        evidence: []
      });
    }
    
    // Recency insight
    const recentDocs = documents.filter(d => {
      const timestamp = new Date(d.metadata.timestamp);
      const daysSince = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince < 30;
    });
    
    if (recentDocs.length > 0) {
      insights.push({
        id: 'insight-recency',
        category: 'fact',
        title: 'Recent Information Available',
        description: `${recentDocs.length} documents from the last 30 days provide current perspectives on "${query}"`,
        importance: 'high',
        evidence: recentDocs.slice(0, 3).map(d => ({
          documentId: d.id,
          excerpt: d.content.substring(0, 150) + '...'
        }))
      });
    }
    
    return insights;
  }

  /**
   * Generate basic recommendations without AI
   */
  private generateBasicRecommendations(documents: Document[], query: string): string[] {
    const recommendations: string[] = [];
    
    if (documents.length < 5) {
      recommendations.push('Consider broadening your search terms to find more relevant information');
    }
    
    const sources = new Set(documents.map(d => d.metadata.source));
    if (sources.size === 1) {
      recommendations.push('Explore additional sources for a more comprehensive view');
    }
    
    return recommendations;
  }

  /**
   * Export results using appropriate plugin
   */
  private async exportResults(
    analysis: AnalysisResult,
    context: QueryContext
  ): Promise<void> {
    const format = context.preferences?.exportFormat || 'markdown';
    const exportPlugin = pluginRegistry.getExportPlugin(format);
    
    if (!exportPlugin) {
      logger.warn({ format }, 'No export plugin found for format');
      return;
    }
    
    const exportContext: ExportContext = {
      userId: context.userId,
      credentials: context.preferences?.exportCredentials,
      options: context.preferences?.exportOptions
    };
    
    await exportPlugin.export(analysis, exportContext);
  }
}

/**
 * Progress tracking with weighted phases
 */
class ProgressTracker {
  private phases = {
    plugin_discovery: { weight: 5, complete: false, message: '' },
    data_collection: { weight: 40, complete: false, message: '' },
    analysis: { weight: 40, complete: false, message: '' },
    export: { weight: 15, complete: false, message: '' }
  };
  
  private pluginProgress = new Map<string, number>();
  private currentProgress = 0;
  private status: 'running' | 'completed' | 'failed' = 'running';
  private error?: string;
  
  constructor(private jobId: string) {}
  
  updatePhase(phase: keyof typeof this.phases, message: string): void {
    if (this.phases[phase]) {
      this.phases[phase].message = message;
    }
  }
  
  completePhase(phase: keyof typeof this.phases): void {
    if (this.phases[phase] && !this.phases[phase].complete) {
      this.phases[phase].complete = true;
      this.currentProgress += this.phases[phase].weight;
    }
  }
  
  updatePlugin(pluginId: string, _message: string, percent?: number): void {
    if (percent !== undefined) {
      this.pluginProgress.set(pluginId, percent);
    }
  }
  
  addProgress(amount: number): void {
    this.currentProgress = Math.min(100, this.currentProgress + amount);
  }
  
  complete(): void {
    this.status = 'completed';
    this.currentProgress = 100;
  }
  
  fail(error: string): void {
    this.status = 'failed';
    this.error = error;
  }
  
  getState(): ProgressState {
    return {
      jobId: this.jobId,
      status: this.status,
      progress: Math.round(this.currentProgress),
      message: this.getCurrentMessage(),
      phases: this.phases,
      pluginProgress: Object.fromEntries(this.pluginProgress),
      error: this.error
    };
  }
  
  private getCurrentMessage(): string {
    for (const [_phase, data] of Object.entries(this.phases)) {
      if (!data.complete && data.message) {
        return data.message;
      }
    }
    return this.status === 'completed' ? 'Research completed' : 'Processing...';
  }
}

interface ResearchResult {
  success: boolean;
  analysis: AnalysisResult;
  pluginResults: PluginExecutionResult[];
  metadata: {
    duration: number;
    pluginsUsed: string[];
    totalDocuments: number;
  };
}

interface ProgressState {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  phases: Record<string, any>;
  pluginProgress: Record<string, number>;
  error?: string;
}