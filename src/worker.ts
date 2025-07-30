import { config } from 'dotenv';
import { createLogger } from './utils/logger.js';
import { pluginRegistry } from './plugins/registry.js';
import { PluginOrchestrator } from './plugins/orchestrator.js';
import { QueryContext } from './plugins/types.js';
import { JobLifecycle } from './types/job.js';
import * as simpleQueue from './services/simpleQueue.js';

// Load environment variables
config();

const logger = createLogger('worker');

// Initialize plugin system
const orchestrator = new PluginOrchestrator(5);

// Job processing function
async function processResearchJob(job: simpleQueue.Job) {
  const { brief, depth, sources, exportFormat, exportCredentials, userId } = job.data;
  const jobLogger = logger.child({ jobId: job.id, brief });
  const lifecycle = new JobLifecycle(job.id, userId);
  
  try {
    jobLogger.info('Starting research job');
    lifecycle.start();
    
    // Store initial progress
    await simpleQueue.updateJobProgress(
      job.id,
      0,
      'Initializing',
      lifecycle.getProgress()
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
      
      // Update progress in database
      await simpleQueue.updateJobProgress(
        job.id,
        state.progress,
        state.message,
        lifecycle.getProgress()
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
      job.id
    );
    
    // Mark job as succeeded
    const jobResult = lifecycle.succeed(result);
    
    // Store final result
    await simpleQueue.completeJob(job.id, jobResult);
    
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
      retryable: job.attempts < 3
    });
    
    // Store error state
    await simpleQueue.failJob(
      job.id,
      error instanceof Error ? error.message : 'Unknown error'
    );
    
    throw error;
  }
}

// Worker loop
async function runWorker() {
  logger.info('Worker started, polling for jobs...');
  
  while (true) {
    try {
      // Get next job
      const job = await simpleQueue.getNextJob();
      
      if (job) {
        logger.info({ jobId: job.id }, 'Processing job');
        
        try {
          await processResearchJob(job);
        } catch (error) {
          logger.error({ jobId: job.id, error }, 'Job processing failed');
        }
      } else {
        // No jobs available, wait a bit
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (error) {
      logger.error({ error }, 'Worker error');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Initialize plugin registry on startup
async function initialize() {
  try {
    logger.info('Initializing plugin registry');
    await pluginRegistry.initialize();
    logger.info('Worker ready to process jobs');
    
    // Start worker loop
    await runWorker();
  } catch (error) {
    logger.error({ error }, 'Failed to initialize worker');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down worker');
  
  await pluginRegistry.dispose();
  simpleQueue.closeDatabase();
  
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