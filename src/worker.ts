import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';
import { createLogger } from './utils/logger.js';
import { pluginRegistry } from './plugins/registry.js';
import { PluginOrchestrator } from './plugins/orchestrator.js';
import { QueryContext } from './plugins/types.js';
import { JobLifecycle } from './types/job.js';

// Load environment variables
config();

const logger = createLogger('worker');

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Initialize plugin system
const orchestrator = new PluginOrchestrator(5);

// Job processing function
async function processResearchJob(job: Job) {
  const { brief, depth, sources, exportFormat, exportCredentials, userId } = job.data;
  const jobLogger = logger.child({ jobId: job.id, brief });
  const lifecycle = new JobLifecycle(job.id!, userId);
  
  try {
    jobLogger.info('Starting research job');
    lifecycle.start();
    
    // Store initial progress
    await connection.setex(
      `job:${job.id}:progress`,
      300,
      JSON.stringify(lifecycle.getProgress())
    );
    
    // Set up progress tracking
    orchestrator.on('progress', async (state) => {
      // Update job lifecycle
      lifecycle.updateStep(state.message, state.progress);
      
      // Update plugin statuses
      for (const [pluginId, progress] of Object.entries(state.pluginProgress || {})) {
        lifecycle.updatePluginStatus(pluginId, {
          status: 'running',
          progress: progress as number
        });
      }
      
      // Update BullMQ progress
      await job.updateProgress(state.progress);
      
      // Store progress in Redis for SSE streaming
      await connection.setex(
        `job:${job.id}:progress`,
        300,
        JSON.stringify(lifecycle.getProgress())
      );
    });
    
    // Build query context
    const context: QueryContext = {
      query: brief,
      depth: depth || 'standard',
      preferences: {
        sources,
        exportFormat,
        exportCredentials
      }
    };
    
    // Execute research
    const result = await orchestrator.executeResearch(
      brief,
      context,
      job.id!
    );
    
    // Mark job as succeeded
    const jobResult = lifecycle.succeed(result);
    
    // Store final progress
    await connection.setex(
      `job:${job.id}:progress`,
      300,
      JSON.stringify(lifecycle.getProgress())
    );
    
    // Store result for retrieval
    await connection.setex(
      `job:${job.id}:result`,
      86400, // 24 hour TTL
      JSON.stringify(jobResult)
    );
    
    jobLogger.info(
      { 
        duration: jobResult.metadata.duration,
        documents: result.metadata.totalDocuments 
      },
      'Research job completed successfully'
    );
    
    return jobResult;
  } catch (error) {
    jobLogger.error({ error }, 'Research job failed');
    
    // Mark job as failed
    lifecycle.fail({
      code: 'RESEARCH_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error,
      retryable: job.attemptsMade < job.opts.attempts!
    });
    
    // Store error state
    await connection.setex(
      `job:${job.id}:progress`,
      300,
      JSON.stringify(lifecycle.getProgress())
    );
    
    throw error;
  }
}

// Create worker
const worker = new Worker('research', processResearchJob, {
  connection,
  concurrency: 5,
  autorun: true
});

// Worker event handlers
worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err }, 'Job failed');
});

worker.on('error', (err) => {
  logger.error({ error: err }, 'Worker error');
});

// Initialize plugin registry on startup
async function initialize() {
  try {
    logger.info('Initializing plugin registry');
    await pluginRegistry.initialize();
    logger.info('Worker ready to process jobs');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize worker');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down worker');
  
  await worker.close();
  await pluginRegistry.dispose();
  await connection.quit();
  
  logger.info('Worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start worker
initialize().catch((error) => {
  logger.error({ error }, 'Worker initialization failed');
  process.exit(1);
});