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
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'research-engine-mcp' });
});

// MCP discovery endpoint
app.get('/.well-known/mcp.json', (_req, res) => {
  res.json({
    version: '1.0.0',
    serverInfo: {
      name: 'research-engine',
      version: '1.0.0',
      description: 'AI-powered research automation'
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false
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

// Main JSON-RPC endpoint
app.post('/', authMiddleware, async (req, res) => {
  const request = req.body as MCPRequest;
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id: request.id
  };

  try {
    switch (request.method) {
      case 'initialize':
        response.result = {
          protocolVersion: '1.0.0',
          serverInfo: {
            name: 'research-engine',
            version: '1.0.0',
            description: 'AI-powered research automation'
          },
          capabilities: {
            tools: {
              listTools: true,
              callTool: true
            }
          }
        };
        break;

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
            code: 'ToolNotFound',
            message: `Tool ${name} not found`
          };
        } else {
          try {
            const result = await tool.handler(args, { user: req.user });
            response.result = result;
          } catch (error) {
            response.error = {
              code: 'ToolExecutionError',
              message: error instanceof Error ? error.message : 'Tool execution failed',
              data: error
            };
          }
        }
        break;

      default:
        response.error = {
          code: 'MethodNotFound',
          message: `Method ${request.method} not found`
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

  res.json(response);
});

// SSE endpoint for progress updates
app.get('/research/:jobId/stream', authMiddleware, async (req, res) => {
  const { jobId } = req.params;
  const redis = new (await import('ioredis')).default(process.env.REDIS_URL || 'redis://localhost:6379');
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable Nginx buffering
  });

  // Send initial connection event
  res.write(`event: connected\ndata: {"jobId": "${jobId}"}\n\n`);
  
  // Poll for progress updates
  const interval = setInterval(async () => {
    try {
      const progressData = await redis.get(`job:${jobId}:progress`);
      
      if (progressData) {
        const progress = JSON.parse(progressData);
        
        // Send progress event
        res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
        
        // If job is complete or failed, send final event and close
        if (progress.status === 'completed' || progress.status === 'failed') {
          res.write(`event: ${progress.status}\ndata: ${JSON.stringify(progress)}\n\n`);
          clearInterval(interval);
          await redis.quit();
          res.end();
        }
      }
    } catch (error) {
      logger.error({ error, jobId }, 'Error streaming progress');
    }
  }, 1000); // Poll every second
  
  // Cleanup on client disconnect
  req.on('close', async () => {
    clearInterval(interval);
    await redis.quit();
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