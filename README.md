# Research Engine MCP Server

AI-powered research automation that turns natural language briefs into actionable insights. Built for commands.com.

## Features

- 🔍 **Automated Research**: Submit a brief and get comprehensive analysis
- 🌐 **Multi-Source**: Searches GitHub, Reddit, Stack Overflow, and more
- 🤖 **AI Analysis**: Extracts pain points, opportunities, and insights
- 📊 **Export Options**: Notion, Markdown, or JSON output
- ⚡ **Async Processing**: Non-blocking with job status tracking

## Architecture

This MCP server follows the commands.com pattern:
- **MCP Server**: Stateless Express.js proxy (this repo)
- **Research API**: Your backend that does the actual work (separate service)

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
- `RESEARCH_API_URL`: Your research API endpoint
- `RESEARCH_API_KEY`: API key for your research service

### 3. Run Development Server

```bash
# Development mode with auto-reload
npm run dev

# With auth disabled for testing
SKIP_AUTH=true npm run dev
```

### 4. Test the Tools

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