export interface Tool<TArgs = any, TResult = any> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: TArgs, context: MCPContext) => Promise<TResult>;
}

export interface MCPContext {
  user?: {
    id: string;
    email: string;
  };
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: string | number;
  message: string;
  data?: any;
}

export interface ResearchJobRequest {
  brief: string;
  depth?: 'quick' | 'standard' | 'deep';
  sources?: string[];
  userId?: string;
  exportFormat?: 'notion' | 'markdown' | 'json';
  exportCredentials?: Record<string, any>;
}

export interface ResearchJobResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  message?: string;
  estimatedTime?: string;
}

export interface ResearchStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  currentStage?: string;
  result?: any;
  error?: string;
  completedAt?: string;
}

export interface ResearchExportRequest {
  jobId: string;
  format: 'notion' | 'markdown' | 'json';
}

export interface ResearchExportResponse {
  success: boolean;
  exportUrl?: string;
  notionPageId?: string;
  data?: any;
  error?: string;
}