# Research API Implementation Guide

This guide shows how to build the Research API that your MCP server connects to.

## Architecture Overview

```
MCP Server (this repo) → Research API (your backend) → External Sources
                                    ↓
                            Job Queue (BullMQ)
                                    ↓
                            Worker Processes
                                    ↓
                            Analysis Engine
```

## Required Endpoints

Your Research API must implement these endpoints:

### 1. Create Research Job
```
POST /api/jobs
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "brief": "Find React deployment pain points",
  "depth": "standard",
  "sources": ["github", "reddit"],
  "userId": "user-123"
}

Response:
{
  "jobId": "job-abc-123",
  "status": "queued",
  "estimatedTime": "15-30 minutes"
}
```

### 2. Get Job Status
```
GET /api/jobs/{jobId}
Authorization: Bearer YOUR_API_KEY

Response:
{
  "jobId": "job-abc-123",
  "status": "processing",  // queued, processing, completed, failed
  "progress": 45,
  "currentStage": "Analyzing GitHub repositories",
  "result": null  // Populated when completed
}
```

### 3. Export Results
```
POST /api/jobs/{jobId}/export
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "format": "notion"  // notion, markdown, json
}

Response:
{
  "success": true,
  "exportUrl": "https://...",  // For file downloads
  "notionPageId": "page-123"   // For Notion exports
}
```

## Example Implementation (Node.js + BullMQ)

### Project Structure
```
research-api/
├── src/
│   ├── api/          # Express routes
│   ├── workers/      # Job processors
│   ├── scrapers/     # GitHub, Reddit, etc.
│   ├── analyzers/    # AI analysis
│   └── exporters/    # Notion, Markdown, etc.
├── package.json
└── .env
```

### Core Dependencies
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "bullmq": "^4.14.0",
    "redis": "^4.6.10",
    "prisma": "^5.7.0",
    "@notionhq/client": "^2.2.13",
    "openai": "^4.20.0",
    "octokit": "^3.1.2",
    "snoowrap": "^1.23.0"
  }
}
```

### Job Queue Setup
```typescript
// src/queue/research.queue.ts
import { Queue, Worker } from 'bullmq';
import { connection } from './redis';

export const researchQueue = new Queue('research', { connection });

// Worker to process jobs
new Worker('research', async (job) => {
  const { brief, depth, sources } = job.data;
  
  // Update progress
  await job.updateProgress(10);
  
  // 1. Discover sources
  const sourceData = await discoverSources(brief, sources);
  await job.updateProgress(30);
  
  // 2. Scrape content
  const content = await scrapeContent(sourceData);
  await job.updateProgress(60);
  
  // 3. Analyze with AI
  const analysis = await analyzeContent(content, brief);
  await job.updateProgress(90);
  
  // 4. Generate insights
  const insights = await generateInsights(analysis);
  await job.updateProgress(100);
  
  return insights;
}, { connection });
```

### Source Discovery
```typescript
// src/scrapers/github.ts
export async function searchGitHub(query: string) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  
  // Search repositories
  const repos = await octokit.rest.search.repos({
    q: `${query} stars:10000..50000`,
    sort: 'stars',
    per_page: 20
  });
  
  // Analyze issues and discussions
  const painPoints = [];
  for (const repo of repos.data.items) {
    const issues = await octokit.rest.issues.listForRepo({
      owner: repo.owner.login,
      repo: repo.name,
      labels: 'bug,enhancement',
      state: 'open',
      per_page: 50
    });
    
    // Extract pain points from issues
    painPoints.push(...extractPainPoints(issues.data));
  }
  
  return painPoints;
}
```

### AI Analysis
```typescript
// src/analyzers/openai.ts
export async function analyzeWithAI(content: any[], brief: string) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const prompt = `
    Research Brief: ${brief}
    
    Analyze the following content and extract:
    1. Main pain points (categorized)
    2. Opportunities (with effort estimates)
    3. Key insights
    4. Recommendations
    
    Content: ${JSON.stringify(content)}
  `;
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' }
  });
  
  return JSON.parse(response.choices[0].message.content);
}
```

### Notion Export
```typescript
// src/exporters/notion.ts
export async function exportToNotion(insights: any, userId: string) {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  
  const page = await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      Title: {
        title: [{
          text: { content: insights.title }
        }]
      },
      Brief: {
        rich_text: [{
          text: { content: insights.brief }
        }]
      },
      Status: {
        select: { name: 'Completed' }
      }
    },
    children: [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ text: { content: 'Key Insights' } }]
        }
      },
      ...insights.insights.map(insight => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ text: { content: insight } }]
        }
      }))
    ]
  });
  
  return page.id;
}
```

## Deployment Options

### 1. DigitalOcean App Platform
- Deploy API + Redis in one platform
- Built-in scaling and monitoring
- Starting at $12/month

### 2. Railway
- One-click deploy with Redis
- Great developer experience
- Pay per use pricing

### 3. AWS (Advanced)
- ECS for API
- ElastiCache for Redis
- SQS for queue (instead of BullMQ)
- More complex but highly scalable

## Security Considerations

1. **API Authentication**: Use API keys or JWT tokens
2. **Rate Limiting**: Implement per-user limits
3. **Input Validation**: Sanitize research briefs
4. **Secure Storage**: Encrypt sensitive data
5. **Access Control**: User can only access their own jobs

## Monitoring

Track these metrics:
- Job completion rate
- Average processing time
- API rate limit usage
- Error rates by source
- Token usage (for AI calls)

## Cost Optimization

1. **Cache Results**: Redis cache for repeated queries
2. **Batch AI Calls**: Process multiple items per API call
3. **Smart Retries**: Exponential backoff for rate limits
4. **Tiered Processing**: Quick depth uses less AI

## Next Steps

1. Start with basic GitHub + Reddit scrapers
2. Add simple keyword-based analysis
3. Integrate OpenAI for deeper insights
4. Add Notion export
5. Scale based on usage patterns