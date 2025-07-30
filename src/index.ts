import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { authMiddleware } from './auth/verifyToken.js';
import { tools } from './tools/index.js';
import { createLogger } from './utils/logger.js';
import type { MCPRequest, MCPResponse } from './types.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger('mcp-server');

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://commands.com', 'https://api.commands.com'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Root endpoint with basic info
app.get('/', (_req, res) => {
  res.json({
    name: 'research-engine',
    description: 'AI-powered research automation',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      discovery: '/.well-known/mcp.json',
      tools: '/mcp/tools',
      execute: '/mcp/tools/:toolName'
    },
    tools: Array.from(tools.values()).map(tool => `${tool.name} - ${tool.description}`)
  });
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'research-engine-mcp' });
});

// MCP discovery endpoint
app.get('/.well-known/mcp.json', (_req, res) => {
  res.json({
    schemaVersion: "2024-11-05",
    vendor: "Commands.com",
    name: "research-engine",
    version: "1.0.0",
    description: "AI-powered research automation",
    license: "MIT",
    capabilities: {
      tools: {
        listChanged: true
      }
    },
    serverInfo: {
      name: "research-engine",
      version: "1.0.0"
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
    console.error(`Error executing tool ${toolName}:`, error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Tool execution failed' 
    });
  }
});

// Helper function to send streaming responses for SSE-enabled gateways
function sendStreamingResponse(res: express.Response, result: any, id: any) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  const response = { jsonrpc: '2.0', result, id };
  res.write(`data: ${JSON.stringify(response)}\n\n`);
  res.end();
}

// Main JSON-RPC endpoint
app.post('/', async (req, res) => {
  // Check if client supports SSE
  const acceptsSSE = req.headers.accept?.includes('text/event-stream');
  
  const request = req.body as MCPRequest;
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id: request.id
  };

  // Allow certain methods without authentication for commands.com verification
  const publicMethods = ['initialize', 'notifications/initialized', 'tools/list', 'resources/list', 'prompts/list'];
  const requiresAuth = !publicMethods.includes(request.method);

  // Apply authentication only for methods that require it
  if (requiresAuth && process.env.SKIP_AUTH !== 'true') {
    await new Promise<void>((resolve, reject) => {
      authMiddleware(req, res, (err?: any) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch(() => {
      // Auth failed, response already sent by authMiddleware
      return;
    });

    // If auth failed, authMiddleware already sent response
    if (res.headersSent) return;
  } else if (process.env.SKIP_AUTH === 'true' && process.env.NODE_ENV === 'development') {
    // Mock user for development
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
            version: '1.0.0'
          }
        };
        break;

      case 'notifications/initialized':
        // Notification - no response needed
        return res.status(200).end();

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
            const result = await tool.handler(args, { user: req.user });
            // Wrap result in MCP format
            response.result = {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }
              ]
            };
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
    console.error('MCP request error:', error);
    response.error = {
      code: 'InternalError',
      message: 'Internal server error',
      data: error
    };
  }

  // Use SSE if client supports it and we have a result
  if (acceptsSSE && response.result) {
    return sendStreamingResponse(res, response.result, request.id);
  }
  
  res.json(response);
});

// SSE endpoint for progress updates
app.get('/research/:jobId/stream', authMiddleware, async (req, res) => {
  const { jobId } = req.params;
  const simpleQueue = await import('./services/simpleQueue.js');
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable Nginx buffering
  });

  // Send initial connection event
  res.write(`event: connected\ndata: {"jobId": "${jobId}"}\n\n`);
  
  let lastStatus = '';
  
  // Poll for progress updates
  const interval = setInterval(async () => {
    try {
      const job = await simpleQueue.getJob(jobId || '');
      const progressData = await simpleQueue.getJobProgress(jobId || '');
      
      if (job) {
        const progress = progressData || {
          jobId: job.id,
          status: job.status,
          percentComplete: job.progress,
          currentStep: job.currentStep || 'Processing',
          messages: [],
          pluginStatuses: {},
          metadata: {
            jobId: job.id,
            createdAt: job.createdAt.toISOString(),
            startedAt: job.startedAt?.toISOString(),
            attempt: job.attempts,
            maxAttempts: 3
          }
        };
        
        // Send progress event
        res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
        
        // If job is complete or failed, send final event and close
        if (job.status === 'completed' || job.status === 'failed') {
          if (lastStatus !== job.status) {
            res.write(`event: ${job.status}\ndata: ${JSON.stringify(progress)}\n\n`);
            clearInterval(interval);
            res.end();
          }
        }
        
        lastStatus = job.status;
      }
    } catch (error) {
      logger.error({ error, jobId }, 'Error streaming progress');
    }
  }, 1000); // Poll every second
  
  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    logger.info({ jobId }, 'Client disconnected from stream');
  });
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Research Engine MCP server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Auth: ${process.env.SKIP_AUTH === 'true' ? 'DISABLED (dev mode)' : 'ENABLED'}`);
});