/**
 * Core plugin interfaces for the research engine
 * Following Chief Architect's production patterns
 */

export interface Document {
  id: string;
  title: string;
  content: string;
  url?: string;
  metadata: {
    source: string;
    timestamp: string;
    relevanceScore?: number;
    [key: string]: any;
  };
}

export interface QueryContext {
  query: string;
  userId?: string;
  preferences?: Record<string, any>;
  depth?: 'quick' | 'standard' | 'deep';
}

export interface PluginContext extends QueryContext {
  jobId: string;
  logger: any;
  cache: any;
  config: Record<string, any>;
  updateProgress: (message: string, percentDelta?: number) => Promise<void>;
}

export interface PluginResult {
  success: boolean;
  documents: Document[];
  metadata: {
    source: string;
    documentsFound: number;
    duration: number;
    cached?: boolean;
  };
  error?: PluginError;
}

export interface PluginError {
  code: 'USER_ERROR' | 'TEMP_ERROR' | 'PERM_ERROR';
  message: string;
  retryIn?: number;
  details?: any;
}

/**
 * Base interface for source plugins
 */
export interface SourcePlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  
  /**
   * Check if this plugin can handle the given query
   */
  supports(query: string, context: QueryContext): boolean;
  
  /**
   * Execute the search/data gathering
   */
  search(context: PluginContext): Promise<PluginResult>;
  
  /**
   * Optional configuration schema
   */
  configSchema?: Record<string, any>;
  
  /**
   * Initialize the plugin (called once on load)
   */
  initialize?(config: Record<string, any>): Promise<void>;
  
  /**
   * Cleanup resources
   */
  dispose?(): Promise<void>;
}

/**
 * Base interface for export plugins
 */
export interface ExportPlugin {
  id: string;
  name: string;
  description: string;
  format: string; // 'notion', 'markdown', 'json', etc.
  
  /**
   * Export the analysis results
   */
  export(
    analysis: AnalysisResult,
    context: ExportContext
  ): Promise<ExportResult>;
  
  /**
   * Validate export configuration
   */
  validateConfig?(config: Record<string, any>): boolean;
}

export interface AnalysisResult {
  id: string;
  query: string;
  summary: string;
  insights: Insight[];
  recommendations: string[];
  sources: Document[];
  metadata: {
    totalDocuments: number;
    analysisDuration: number;
    confidence: number;
    timestamp: string;
  };
}

export interface Insight {
  id: string;
  category: string;
  title: string;
  description: string;
  importance: 'high' | 'medium' | 'low';
  evidence: Array<{
    documentId: string;
    excerpt: string;
  }>;
}

export interface ExportContext {
  userId?: string;
  credentials?: Record<string, any>;
  options?: Record<string, any>;
}

export interface ExportResult {
  success: boolean;
  format: string;
  location?: string; // URL, file path, or ID
  data?: any;
  error?: string;
}

/**
 * Plugin lifecycle status
 */
export enum PluginStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped'
}

/**
 * Plugin execution result with timing
 */
export interface PluginExecutionResult {
  pluginId: string;
  status: PluginStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  result?: PluginResult;
  error?: PluginError;
}