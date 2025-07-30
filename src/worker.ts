import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';
import { createLogger } from './utils/logger.js';

// Load environment variables
config();

// Import your research tasks
import { scrapeGitHub } from './tasks/github.js';
import { scrapeReddit } from './tasks/reddit.js';
import { analyzeWithAI } from './tasks/analyze.js';
import { exportToNotion } from './tasks/export.js';

const logger = createLogger('worker');

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Job processing function
async function processResearchJob(job: Job) {
  const { brief, depth, sources, exportFormat, notionKey, notionDatabaseId } = job.data;
  const jobLogger = logger.child({ jobId: job.id, brief });
  
  try {
    // Initialize result structure
    const result = {
      sourceData: [] as any[],
      insights: null as any,
      export: null as any,
      metadata: {
        startTime: new Date().toISOString(),
        endTime: '',
        duration: 0,
        sourcesScraped: 0,
        errors: [] as string[]
      }
    };
    
    // Step 1: Scrape sources
    jobLogger.info('Starting source scraping');
    await job.updateProgress(10);
    
    // GitHub scraping
    if (sources.includes('github')) {
      try {
        jobLogger.info('Scraping GitHub');
        const githubData = await scrapeGitHub(brief);
        result.sourceData.push(...githubData);
        result.metadata.sourcesScraped += githubData.length;
        await job.updateProgress(30);
      } catch (error) {
        jobLogger.error({ error }, 'GitHub scraping failed');
        result.metadata.errors.push(`GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue with other sources
      }
    }
    
    // Reddit scraping
    if (sources.includes('reddit')) {
      try {
        jobLogger.info('Scraping Reddit');
        const redditData = await scrapeReddit(brief);
        result.sourceData.push(...redditData);
        result.metadata.sourcesScraped += redditData.length;
        await job.updateProgress(50);
      } catch (error) {
        jobLogger.error({ error }, 'Reddit scraping failed');
        result.metadata.errors.push(`Reddit: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue with analysis if we have some data
      }
    }
    
    // Check if we have enough data to analyze
    if (result.sourceData.length === 0) {
      throw new Error('No data collected from any source');
    }
    
    // Step 2: Analyze with AI
    jobLogger.info({ sources: result.sourceData.length }, 'Starting AI analysis');
    await job.updateProgress(60);
    
    try {
      result.insights = await analyzeWithAI(result.sourceData, brief, depth);
      await job.updateProgress(80);
    } catch (error) {
      jobLogger.error({ error }, 'AI analysis failed');
      throw new Error(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Step 3: Export results
    jobLogger.info(`Exporting to ${exportFormat}`);
    await job.updateProgress(90);
    
    if (exportFormat === 'notion' && notionKey && notionDatabaseId) {
      try {
        result.export = await exportToNotion(result.insights, {
          notionKey,
          notionDatabaseId
        });
      } catch (error) {
        jobLogger.error({ error }, 'Notion export failed');
        result.metadata.errors.push(`Export: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Fallback to returning raw data
        result.export = {
          format: 'json',
          data: result.insights
        };
      }
    } else {
      // Default export format
      result.export = {
        format: exportFormat || 'json',
        data: result.insights
      };
    }
    
    // Finalize metadata
    result.metadata.endTime = new Date().toISOString();
    result.metadata.duration = Date.now() - new Date(result.metadata.startTime).getTime();
    
    await job.updateProgress(100);
    jobLogger.info({ duration: result.metadata.duration }, 'Research job completed');
    
    return {
      success: true,
      insights: result.insights,
      export: result.export,
      metadata: result.metadata
    };
  } catch (error) {
    jobLogger.error({ error }, 'Job failed');
    throw error;
  }
}

// Create worker with proper configuration
const worker = new Worker('research', processResearchJob, {
  connection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
  removeOnComplete: {
    count: 100,
    age: 24 * 3600 // 24 hours
  },
  removeOnFail: {
    count: 50,
    age: 7 * 24 * 3600 // 7 days
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: true,
    removeOnFail: false
  }
});

// Worker event handlers
worker.on('completed', (job) => {
  logger.info({ jobId: job.id, duration: job.duration }, 'Job completed successfully');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Job failed');
});

worker.on('error', (err) => {
  logger.error({ error: err }, 'Worker error');
});

worker.on('stalled', (jobId) => {
  logger.warn({ jobId }, 'Job stalled');
});

// Health check
let isHealthy = true;
worker.on('error', () => { isHealthy = false; });
worker.on('failed', () => { isHealthy = true; }); // Worker is still processing

// Graceful shutdown
async function shutdown() {
  logger.info('Worker shutting down...');
  
  // Stop accepting new jobs
  await worker.close();
  
  // Wait for current jobs to complete (max 30 seconds)
  const timeout = setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
  
  await worker.disconnect();
  clearTimeout(timeout);
  
  logger.info('Worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start worker
logger.info({
  concurrency: worker.concurrency,
  redis: process.env.REDIS_URL || 'localhost:6379'
}, 'Research worker started');

// Export for testing
export { worker, isHealthy };