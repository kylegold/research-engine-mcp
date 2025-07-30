import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { authMiddleware } from './auth/verifyToken.js';
import { tools } from './tools/index.js';
import type { MCPRequest, MCPResponse, MCPError } from './types.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'research-engine-mcp' });
});

// MCP discovery endpoint
app.get('/.well-known/mcp.json', (req, res) => {
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
app.get('/mcp/tools', authMiddleware, (req, res) => {
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
  const tool = tools.get(toolName);
  
  if (!tool) {
    return res.status(404).json({ error: `Tool ${toolName} not found` });
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

// SSE endpoint for progress updates (future enhancement)
app.get('/research/:jobId/stream', authMiddleware, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // TODO: Implement real-time progress streaming
  res.write('data: {"message": "Streaming not yet implemented"}\n\n');
  
  req.on('close', () => {
    console.log('Client disconnected from stream');
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Research Engine MCP server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Auth: ${process.env.SKIP_AUTH === 'true' ? 'DISABLED (dev mode)' : 'ENABLED'}`);
});