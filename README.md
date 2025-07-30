# Research Engine MCP Server

AI-powered research automation that turns natural language briefs into comprehensive, actionable insights. Built for [commands.com](https://commands.com).

## 🚀 Features

- **🔍 Automated Multi-Source Research**: Searches GitHub repositories, web sources, and more
- **🤖 AI-Powered Analysis**: Uses OpenAI to extract pain points, opportunities, and actionable insights
- **📊 Flexible Export**: Output to Notion, Markdown, or JSON
- **⚡ Async Processing**: Non-blocking with real-time progress tracking via SSE
- **🔌 Plugin Architecture**: Extensible system for adding new data sources and export formats
- **💾 Zero Dependencies**: Uses SQLite for job queue (no Redis required)
- **🏭 Production Ready**: Circuit breakers, rate limiting, and comprehensive error handling

## 🏗️ Architecture

This MCP server implements a modern, scalable architecture:

- **MCP Server**: Stateless Express.js server that handles commands.com requests
- **Worker Process**: Background worker that processes research jobs (5-60 minutes)
- **SQLite Queue**: Lightweight job management with no external dependencies
- **Plugin System**: Modular architecture for sources (GitHub, Web) and exports (Notion, Markdown)
- **Real-time Updates**: Server-Sent Events (SSE) for progress streaming

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- OpenAI API key (required)
- GitHub token (optional, for better rate limits)
- Notion API key (optional, for Notion export)

### Installation

```bash
# Clone the repository
git clone https://github.com/kylegold/research-engine-mcp
cd research-engine-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Configuration

Create a `.env` file:

```env
# Required
OPENAI_API_KEY=your-openai-api-key

# Optional (for enhanced features)
GITHUB_TOKEN=your-github-token
PLUGIN_REDDIT_CLIENTID=your-reddit-client-id
PLUGIN_REDDIT_CLIENTSECRET=your-reddit-client-secret
```

### Running Locally

```bash
# Run both server and worker (recommended)
npm run dev:all

# Or run separately:
npm run dev        # MCP server only
npm run dev:worker # Worker only

# Test without auth (development only)
SKIP_AUTH=true npm run dev:all
```

## 📡 Available Tools

### `research_brief`
Submit a research request and receive a job ID for tracking.

**Parameters:**
- `brief` (required): Natural language description of what to research
- `depth`: Research depth - `quick` (5-10min), `standard` (15-30min), or `deep` (45-60min)
- `sources`: Array of sources to search (defaults to all available)
- `exportFormat`: Output format - `notion`, `markdown`, or `json`
- `exportCredentials`: Credentials for export (e.g., `{notionKey, notionDatabaseId}`)

**Example:**
```json
{
  "brief": "Find developer pain points for React deployment workflows",
  "depth": "standard",
  "sources": ["github", "websearch"],
  "exportFormat": "markdown"
}
```

### `research_status`
Check the status and progress of a research job.

**Parameters:**
- `jobId` (required): The job ID returned from research_brief

**Example:**
```json
{
  "jobId": "abc-123-def-456"
}
```

### `research_export`
Export completed research results (if not auto-exported).

**Parameters:**
- `jobId` (required): The job ID to export
- `format`: Export format (overrides original setting)

## 🔌 Plugin System

### Available Source Plugins

- **GitHub**: Searches repositories and issues (10-50k stars)
- **WebSearch**: General web search with relevance scoring
- **Auto**: Automatically selects appropriate sources

### Available Export Plugins

- **Notion**: Creates rich pages in your Notion workspace
- **Markdown**: Generates comprehensive markdown reports
- **JSON**: Structured data for programmatic use

### Creating Custom Plugins

See [Plugin Development Guide](docs/PLUGIN_DEVELOPMENT.md) for creating your own source or export plugins.

## 🚀 Deployment

### Deploy to Railway (Recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/deploy-research-engine)

1. Click the deploy button
2. Add your `OPENAI_API_KEY`
3. Deploy! (SQLite database is created automatically)

### Manual Deployment

The server includes a `Dockerfile` and is ready for deployment to any container platform:

```bash
# Build the image
docker build -t research-engine .

# Run the container
docker run -e OPENAI_API_KEY=your-key -p 3000:3000 research-engine
```

## 📊 Performance & Limits

- Handles 10,000+ jobs per day with SQLite
- Concurrent plugin execution (5 parallel by default)
- Built-in rate limiting for external APIs
- Circuit breakers prevent cascade failures
- In-memory caching reduces API calls

## 🛠️ Development

### Project Structure

```
src/
├── plugins/           # Plugin system
│   ├── sources/      # Data source plugins
│   └── exports/      # Export format plugins
├── services/         # Core services
│   └── simpleQueue.ts # SQLite job queue
├── analysis/         # AI analysis engine
├── utils/           # Utilities (cache, rate limiter, etc.)
└── worker.ts        # Background job processor
```

### Testing

```bash
# Test the database connection
npm run test:db

# Run the test suite
npm test
```

### Building

```bash
# Build TypeScript
npm run build

# Run linting
npm run lint

# Format code
npm run format
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for [commands.com](https://commands.com)
- Powered by OpenAI for intelligent analysis
- Plugin architecture inspired by production MCP patterns

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/kylegold/research-engine-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/kylegold/research-engine-mcp/discussions)

---

Made with ❤️ by Kyle Goldfarb