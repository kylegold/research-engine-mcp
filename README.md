# Research Engine MCP Server

AI-powered research automation that turns natural language briefs into actionable insights. Built for commands.com.

## Features

- 🔍 **Automated Research**: Submit a brief and get comprehensive analysis
- 🌐 **Multi-Source**: Searches GitHub, Reddit, Stack Overflow, and more
- 🤖 **AI Analysis**: Extracts pain points, opportunities, and insights
- 📊 **Export Options**: Notion, Markdown, or JSON output
- ⚡ **Async Processing**: Non-blocking with job status tracking

## Architecture

This MCP server implements a queue-based architecture:
- **MCP Server**: Stateless Express.js server that returns job IDs immediately
- **Worker Process**: Background worker that processes research jobs (5-60 minutes)
- **Redis Queue**: BullMQ for job management and progress tracking
- **Same Codebase**: Both server and worker are in this repo

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/research-engine-mcp
cd research-engine-mcp
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:
- `REDIS_URL`: Redis connection for job queue
- `GITHUB_TOKEN`: GitHub personal access token
- `OPENAI_API_KEY`: OpenAI API key for analysis
- `REDDIT_CLIENT_ID/SECRET`: Reddit API credentials (optional)

### 3. Start Redis

```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or install locally
brew install redis  # macOS
brew services start redis
```

### 4. Run Development Server

```bash
# Run both MCP server and worker
npm run dev:all

# Or run separately:
npm run dev        # MCP server only
npm run dev:worker # Worker only

# With auth disabled for testing
SKIP_AUTH=true npm run dev:all
```

### 5. Test the Tools

```bash
# Test research_brief tool
curl -X POST http://localhost:3000/mcp/tools/research_brief \
  -H "Content-Type: application/json" \
  -d '{"brief": "Find developer pain points for React deployment"}'

# Check status
curl -X POST http://localhost:3000/mcp/tools/research_status \
  -H "Content-Type: application/json" \
  -d '{"jobId": "YOUR_JOB_ID"}'
```

## Available Tools

### research_brief
Submit a research request
```json
{
  "brief": "Your research question",
  "depth": "standard",  // quick, standard, or deep
  "sources": ["github", "reddit"]
}
```

### research_status
Check job progress
```json
{
  "jobId": "abc-123-def"
}
```

### research_export
Export completed research
```json
{
  "jobId": "abc-123-def",
  "format": "notion"  // notion, markdown, or json
}
```

## Deployment

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/)

1. Click the button above
2. Configure environment variables
3. Deploy!

### Deploy to Heroku

```bash
heroku create your-research-engine
heroku config:set RESEARCH_API_URL=https://your-api.com
heroku config:set RESEARCH_API_KEY=your-key
git push heroku main
```

## Building Your Research API

The MCP server delegates to your Research API. Here's the required endpoints:

```
POST   /api/jobs          # Create research job
GET    /api/jobs/:id      # Get job status  
POST   /api/jobs/:id/export  # Export results
```

See [research-api-example](./docs/research-api-example.md) for implementation details.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## License

MIT - see [LICENSE](LICENSE) file