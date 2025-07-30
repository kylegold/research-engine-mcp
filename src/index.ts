import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import { authMiddleware } from './auth/verifyToken.js';
import { tools } from './tools/index.js';
import { createLogger } from './utils/logger.js';
import { initializePlugins, runResearch } from './plugins/simple-orchestrator.js';
import type { MCPRequest, MCPResponse } from './types.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger('mcp-server');

// In-memory job store (can be replaced with Redis/DB for persistence)
const jobs = new Map<string, {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}>();

// Limit concurrent research jobs
const jobQueue = pLimit(3); // Max 3 concurrent research jobs

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://commands.com', 'https://api.commands.com'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Initialize plugins on startup
initializePlugins().catch(err => {
  logger.error({ error: err }, 'Failed to initialize plugins');
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'research-engine',
    description: 'AI-powered research automation',
    version: '2.0.0',
    endpoints: {
      health: '/health',
      discovery: '/.well-known/mcp.json',
      tools: '/mcp/tools',
      execute: '/mcp/tools/:toolName',
      status: '/research/:jobId',
      mcp: '/' // Main JSON-RPC endpoint
    }
  });
});

// Health check endpoint - simple and fast
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'research-engine-mcp' });
});

// MCP discovery endpoint
app.get('/.well-known/mcp.json', (_req, res) => {
  res.json({
    schemaVersion: "2024-11-05",
    vendor: "Commands.com",
    name: "research-engine",
    version: "2.0.0",
    description: "AI-powered research automation",
    license: "MIT",
    capabilities: {
      tools: {
        listChanged: true
      }
    },
    serverInfo: {
      name: "research-engine",
      version: "2.0.0"
    }
  });
});

// List available tools
app.get('/mcp/tools', authMiddleware, (_req, res) => {
  const toolList = Array.from(tools.values()).map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
  
  res.json({ tools: toolList });
});

// Direct tool execution endpoint
app.post('/mcp/tools/:toolName', authMiddleware, async (req, res) => {
  const { toolName } = req.params;
  const tool = tools.get(toolName || '');
  
  if (!tool) {
    res.status(404).json({ error: `Tool ${toolName} not found` });
    return;
  }
  
  try {
    const result = await tool.handler(req.body, { user: req.user });
    res.json(result);
  } catch (error) {
    logger.error(`Error executing tool ${toolName}:`, error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Tool execution failed' 
    });
  }
});

// Research job status endpoint
app.get('/research/:jobId', authMiddleware, async (req, res) => {
  const job = jobs.get(req.params.jobId || '');
  
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt
  });
});

// Process research job asynchronously
async function processResearchJob(jobId: string, brief: string, options: any) {
  const job = jobs.get(jobId);
  if (!job) return;
  
  try {
    job.status = 'processing';
    job.progress = 10;
    
    // Run research using simplified orchestrator
    const result = await runResearch(brief, options, (progress) => {
      if (job) job.progress = Math.min(progress, 90);
    });
    
    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date();
    
    logger.info({ jobId, duration: Date.now() - job.createdAt.getTime() }, 'Research job completed');
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.completedAt = new Date();
    
    logger.error({ jobId, error }, 'Research job failed');
  }
}

// Main JSON-RPC endpoint
app.post('/', async (req, res) => {
  const request = req.body as MCPRequest;
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id: request.id
  };

  // Allow certain methods without authentication
  const publicMethods = ['initialize', 'notifications/initialized', 'tools/list', 'resources/list', 'prompts/list'];
  const requiresAuth = !publicMethods.includes(request.method);

  if (requiresAuth && process.env.SKIP_AUTH !== 'true') {
    await new Promise<void>((resolve, reject) => {
      authMiddleware(req, res, (err?: any) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch(() => {
      return;
    });

    if (res.headersSent) return;
  } else if (process.env.SKIP_AUTH === 'true' && process.env.NODE_ENV === 'development') {
    req.user = { id: 'dev-user', email: 'dev@example.com' };
  }

  try {
    switch (request.method) {
      case 'initialize':
        response.result = {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {
              listChanged: true
            }
          },
          serverInfo: {
            name: 'research-engine',
            version: '2.0.0'
          }
        };
        break;

      case 'notifications/initialized':
        res.status(200).end();
        return;

      case 'tools/list':
        response.result = {
          tools: Array.from(tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        };
        break;

      case 'tools/call':
        const { name, arguments: args } = request.params;
        const tool = tools.get(name);
        
        if (!tool) {
          response.error = {
            code: -32602,
            message: `Tool not found: ${name}`
          };
        } else {
          try {
            // Special handling for research_brief - make it async
            if (name === 'research_brief') {
              const jobId = uuidv4();
              const job = {
                id: jobId,
                status: 'pending' as const,
                progress: 0,
                createdAt: new Date()
              };
              jobs.set(jobId, job);
              
              // Queue the job for processing
              jobQueue(async () => {
                await processResearchJob(jobId, args.brief, {
                  depth: args.depth,
                  sources: args.sources,
                  exportFormat: args.exportFormat,
                  exportCredentials: args.exportCredentials,
                  userId: req.user?.id
                });
              });
              
              response.result = {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      jobId,
                      message: `Research job started! Check status with research_status tool using jobId: ${jobId}`,
                      estimatedTime: args.depth === 'deep' ? '5-10 minutes' : '2-5 minutes'
                    }, null, 2)
                  }
                ]
              };
            } else if (name === 'research_status') {
              // Handle status checking
              const job = jobs.get(args.jobId);
              
              if (!job) {
                response.result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        success: false,
                        error: 'Job not found',
                        message: 'Research job not found. Please check the jobId.'
                      }, null, 2)
                    }
                  ]
                };
              } else {
                let statusResponse: any;
                
                if (job.status === 'completed') {
                  statusResponse = {
                    success: true,
                    jobId: job.id,
                    status: job.status,
                    message: 'Research completed successfully!',
                    result: job.result,
                    completedAt: job.completedAt,
                    nextStep: 'Use research_export to view the results'
                  };
                } else if (job.status === 'failed') {
                  statusResponse = {
                    success: false,
                    jobId: job.id,
                    status: job.status,
                    error: job.error || 'Research job failed',
                    message: 'The research job encountered an error'
                  };
                } else {
                  statusResponse = {
                    success: true,
                    jobId: job.id,
                    status: job.status,
                    progress: job.progress || 0,
                    message: `Research in progress (${job.progress}% complete)`,
                    hint: 'Check back in a few moments'
                  };
                }
                
                response.result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(statusResponse, null, 2)
                    }
                  ]
                };
              }
            } else if (name === 'research_export') {
              // Handle export
              const job = jobs.get(args.jobId);
              
              if (!job) {
                response.result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        success: false,
                        error: 'Job not found',
                        message: 'Research job not found. Please check the jobId.'
                      }, null, 2)
                    }
                  ]
                };
              } else if (job.status !== 'completed') {
                response.result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        success: false,
                        message: `Cannot export: Research job is ${job.status}. Please wait for completion.`,
                        currentStatus: job.status,
                        progress: job.progress
                      }, null, 2)
                    }
                  ]
                };
              } else {
                // Format results based on requested format
                const format = args.format || 'markdown';
                let exportContent: string;
                
                if (format === 'json') {
                  exportContent = JSON.stringify(job.result, null, 2);
                } else if (format === 'markdown') {
                  // Simple markdown formatting
                  const result = job.result;
                  exportContent = `# Research Results\n\n`;
                  exportContent += `**Query**: ${result.query || 'N/A'}\n\n`;
                  exportContent += `**Summary**: ${result.summary || 'No summary available'}\n\n`;
                  exportContent += `## Sources Found (${result.sources?.length || 0})\n\n`;
                  
                  if (result.sources && result.sources.length > 0) {
                    result.sources.forEach((source: any, index: number) => {
                      exportContent += `### ${index + 1}. ${source.title}\n`;
                      exportContent += `- **URL**: ${source.url}\n`;
                      exportContent += `- **Content**: ${source.content}\n`;
                      if (source.metadata) {
                        exportContent += `- **Metadata**: ${JSON.stringify(source.metadata)}\n`;
                      }
                      exportContent += '\n';
                    });
                  }
                } else {
                  exportContent = 'Format not supported yet';
                }
                
                response.result = {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        success: true,
                        format,
                        content: exportContent
                      }, null, 2)
                    }
                  ]
                };
              }
            } else {
              // Handle other tools normally
              const result = await tool.handler(args, { user: req.user });
              response.result = {
                content: [
                  {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                  }
                ]
              };
            }
          } catch (error) {
            response.error = {
              code: -32603,
              message: `Tool execution failed: ${(error as Error).message}`
            };
          }
        }
        break;

      case 'resources/list':
        response.result = {
          resources: []
        };
        break;
        
      case 'prompts/list':
        response.result = {
          prompts: []
        };
        break;
        
      default:
        response.error = {
          code: -32601,
          message: `Method not found: ${request.method}`
        };
    }
  } catch (error) {
    logger.error('MCP request error:', error);
    response.error = {
      code: 'InternalError',
      message: 'Internal server error',
      data: error
    };
  }

  res.json(response);
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Research Engine MCP server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Auth: ${process.env.SKIP_AUTH === 'true' ? 'DISABLED (dev mode)' : 'ENABLED'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});