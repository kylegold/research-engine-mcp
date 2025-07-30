# Commands.com MCP Compatibility Guide

## Key Patterns for Production MCP Servers

### 1. **Job Lifecycle Management**
- Use consistent job states: `QUEUED` → `RUNNING` → `SUCCEEDED`/`FAILED`
- Implement proper job metadata tracking
- Support job listing with filtering by state
- Include timing information (created, started, completed timestamps)

### 2. **Error Handling**
- Use structured error types: `USER_ERROR`, `TEMP_ERROR`, `PERM_ERROR`
- Include retry information for temporary errors
- Provide clear, actionable error messages
- Implement circuit breakers for external services

### 3. **Progress Tracking**
- Use SSE (Server-Sent Events) for real-time updates
- Implement weighted progress phases
- Support per-plugin progress tracking
- Include meaningful status messages

### 4. **Authentication**
- Support JWT-based authentication
- Allow development mode with `SKIP_AUTH=true`
- Validate tokens with proper middleware
- Include user context in all operations

### 5. **Tool Interface**
- Follow MCP tool schema strictly
- Provide comprehensive descriptions
- Use proper JSON Schema for parameters
- Support both JSON-RPC and REST endpoints

### 6. **Resource Management**
- Implement connection pooling
- Use Redis for job queuing and caching
- Clean up resources on shutdown
- Support graceful shutdowns

### 7. **Observability**
- Use structured logging with correlation IDs
- Track plugin performance metrics
- Implement health check endpoints
- Support debug mode for development

### 8. **Configuration**
- Use environment variables for secrets
- Support per-plugin configuration
- Validate configuration on startup
- Provide sensible defaults

## Example Implementation Patterns

### Structured Response Format
```typescript
interface MCPToolResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    duration: number;
    usage?: {
      tokens?: number;
      credits?: number;
    };
  };
}
```

### Job Status Response
```typescript
interface JobStatus {
  id: string;
  state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  progress: number;
  message: string;
  result?: any;
  error?: JobError;
  metadata: {
    created: string;
    started?: string;
    completed?: string;
    duration?: number;
  };
}
```

### SSE Progress Format
```typescript
interface ProgressEvent {
  event: 'progress' | 'completed' | 'failed';
  data: {
    jobId: string;
    progress: number;
    message: string;
    phases?: Record<string, PhaseStatus>;
    pluginProgress?: Record<string, number>;
  };
}
```

## Commands.com Specific Requirements

1. **Tool Naming**: Use lowercase with underscores (e.g., `research_ask`, `research_result`)

2. **Tool Descriptions**: Clear, concise descriptions under 100 characters

3. **Parameter Validation**: Strict JSON Schema validation with helpful error messages

4. **Response Times**: 
   - Acknowledge job creation within 1 second
   - Provide initial progress update within 5 seconds
   - Complete simple queries within 30 seconds

5. **Rate Limiting**: Implement per-user rate limits with clear error messages

6. **Usage Tracking**: Track and report usage for billing purposes

## Testing Checklist

- [ ] Tool discovery endpoint returns valid schema
- [ ] Authentication works with valid JWT tokens
- [ ] Jobs progress from QUEUED to completion
- [ ] SSE streams provide real-time updates
- [ ] Errors are properly structured and informative
- [ ] Resource cleanup on connection close
- [ ] Graceful shutdown preserves job state
- [ ] Health check endpoint responds quickly
- [ ] Rate limiting works as expected
- [ ] All tools validate input parameters