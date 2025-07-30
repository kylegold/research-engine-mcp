# Research Engine - Production Implementation Plan

Based on Chief Architect's production patterns for commands.com

## 🎯 Goal
Build a research MCP server matching Chief Architect's quality standards:
- Production-ready from day one
- Elegant async job handling
- Plugin architecture for extensibility
- Smooth, responsive UX

## 📋 Implementation Checklist

### Phase 1: Core Infrastructure (Week 1)
- [ ] Refactor to plugin architecture
- [ ] Implement job lifecycle (QUEUED → RUNNING → SUCCEEDED/FAILED)
- [ ] Add SSE streaming for real-time updates
- [ ] Structured error taxonomy (USER_ERROR, TEMP_ERROR, PERM_ERROR)
- [ ] Weighted progress tracking

### Phase 2: Production Robustness (Week 2)
- [ ] Circuit breakers per plugin
- [ ] Partial success handling
- [ ] OpenTelemetry tracing
- [ ] Prometheus metrics
- [ ] Structured logging with job context

### Phase 3: Plugin System (Week 3)
- [ ] Core plugin interface
- [ ] Built-in plugins (GitHub, WebSearch, Markdown)
- [ ] Plugin discovery and loading
- [ ] Graceful failure isolation
- [ ] Plugin timeout and retry wrapper

### Phase 4: UX Polish (Week 4)
- [ ] Meaningful progress messages
- [ ] Markdown formatting for results
- [ ] Actionable summary template
- [ ] Latency perception optimization
- [ ] Result size capping

### Phase 5: Deployment (Week 5)
- [ ] Multi-arch Docker image
- [ ] Kubernetes manifests with HPA
- [ ] Blue-green deployment
- [ ] Health checks and readiness probes
- [ ] CI/CD pipeline

## 🏗️ Architecture Changes

### Current (Too Rigid)
```
GitHub Scraper → AI Analysis → Notion Export
```

### New (Flexible & Production-Ready)
```
┌─────────────────────────────────────────────────┐
│             MCP Server (Gateway)                │
│  - Async job creation (202 Accepted)            │
│  - SSE streaming updates                        │
│  - Status polling fallback                      │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│           Job Orchestrator                      │
│  - Plugin discovery & selection                 │
│  - Progress aggregation                         │
│  - Failure isolation                           │
└─────────────────┬───────────────────────────────┘
                  │
     ┌────────────┴────────────┬─────────────────┐
     ▼                         ▼                 ▼
┌─────────┐            ┌──────────┐      ┌──────────┐
│ GitHub  │            │ WebSearch│      │  PubMed  │
│ Plugin  │            │  Plugin  │      │  Plugin  │
└─────────┘            └──────────┘      └──────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  AI Analysis    │
                    └────────┬────────┘
                             │
          ┌──────────────────┴─────────────────┐
          ▼                                    ▼
    ┌──────────┐                        ┌──────────┐
    │  Notion  │                        │ Markdown │
    │ Exporter │                        │ Exporter │
    └──────────┘                        └──────────┘
```

## 📦 Plugin Interface

```typescript
interface ResearchPlugin {
  id: string;
  name: string;
  description: string;
  
  // Does this plugin support this query?
  supports(query: string, context: QueryContext): boolean;
  
  // Execute search/analysis
  run(query: string, context: PluginContext): Promise<PluginResult>;
  
  // Configuration schema
  configSchema?: JSONSchema;
}

interface PluginResult {
  success: boolean;
  documents: Document[];
  metadata: {
    source: string;
    count: number;
    duration: number;
  };
  error?: PluginError;
}
```

## 🔄 Job Lifecycle

```typescript
enum JobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  PARTIAL_OK = 'partial_ok',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

interface JobProgress {
  status: JobStatus;
  percentComplete: number;
  currentStep: string;
  messages: string[];
  pluginStatuses: Record<string, PluginStatus>;
}
```

## 📊 Progress Weighting

```typescript
const PROGRESS_WEIGHTS = {
  plugin_discovery: 5,
  data_collection: 40,
  analysis: 40,
  export: 15
};

// Example progress calculation
function calculateProgress(job: Job): number {
  const weights = PROGRESS_WEIGHTS;
  let progress = 0;
  
  if (job.pluginsDiscovered) progress += weights.plugin_discovery;
  
  // Add weighted plugin progress
  const pluginProgress = job.plugins
    .map(p => p.progress * (weights.data_collection / job.plugins.length))
    .reduce((a, b) => a + b, 0);
  progress += pluginProgress;
  
  if (job.analysisComplete) progress += weights.analysis;
  if (job.exportComplete) progress += weights.export;
  
  return Math.min(progress, 100);
}
```

## 🚨 Error Handling

```typescript
class ResearchError extends Error {
  constructor(
    public code: 'USER_ERROR' | 'TEMP_ERROR' | 'PERM_ERROR',
    message: string,
    public retryIn?: number
  ) {
    super(message);
  }
}

// Example usage
if (!query || query.length < 3) {
  throw new ResearchError('USER_ERROR', 'Query too short (min 3 chars)');
}

if (rateLimitExceeded) {
  throw new ResearchError('TEMP_ERROR', 'Rate limit exceeded', 120);
}
```

## 🎯 UX Examples

### Starting Research
```
> /research "EV battery market trends"
< Research started (ID: r_2024_abc123)
< Discovering relevant sources... 15%
< Found 4 sources: Web Search, Industry Reports, Reddit, News
< Analyzing 47 documents... 45%
< Extracting insights... 75%
< Formatting results... 90%
< ✓ Analysis complete! Key findings:
```

### Progress Updates (SSE)
```javascript
event: progress
data: {"percent": 25, "message": "Analyzing GitHub discussions..."}

event: plugin_complete
data: {"plugin": "github", "documents": 23, "duration": 4.2}

event: complete
data: {"status": "succeeded", "resultUrl": "/research/r_2024_abc123"}
```

## 🚀 Deployment Strategy

### 1. Kubernetes Resources
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: research-mcp-server
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

### 2. Auto-scaling
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: research-mcp-hpa
spec:
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Pods
    pods:
      metric:
        name: job_queue_depth
      target:
        type: AverageValue
        averageValue: "10"
```

## 📈 Success Metrics

- **Reliability**: 99.9% uptime
- **Performance**: p95 < 3s for job creation
- **UX**: 90%+ completion rate for started jobs
- **Scalability**: Handle 100 concurrent research jobs
- **Quality**: Actionable insights in 80%+ of results

## 🎯 Next Steps

1. **Refactor current code** to plugin architecture
2. **Implement SSE streaming** for real-time updates
3. **Add circuit breakers** and retry logic
4. **Create 3 initial plugins**: GitHub, WebSearch, Markdown
5. **Deploy to staging** with full monitoring
6. **Load test** to 10x expected traffic
7. **Polish UX** based on feedback
8. **Go live** on commands.com

This plan ensures your Research Engine matches the Chief Architect's production quality standards.