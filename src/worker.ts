import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from 'dotenv';

// Load environment variables
config();

// Import your research tasks
import { scrapeGitHub } from './tasks/github.js';
import { scrapeReddit } from './tasks/reddit.js';
import { analyzeWithAI } from './tasks/analyze.js';
import { exportToNotion } from './tasks/export.js';

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Create worker
const worker = new Worker('research', async (job) => {
  const { brief, depth, sources, exportFormat, notionKey, notionDatabaseId } = job.data;
  
  try {
    // Update progress
    await job.updateProgress(10);
    console.log(`Starting research job ${job.id}: ${brief}`);
    
    // Step 1: Scrape sources
    await job.updateProgress(20);
    const sourceData = [];
    
    if (sources.includes('github')) {
      console.log('Scraping GitHub...');
      const githubData = await scrapeGitHub(brief);
      sourceData.push(...githubData);
    }
    
    if (sources.includes('reddit')) {
      await job.updateProgress(40);
      console.log('Scraping Reddit...');
      const redditData = await scrapeReddit(brief);
      sourceData.push(...redditData);
    }
    
    // Step 2: Analyze with AI
    await job.updateProgress(60);
    console.log('Analyzing with AI...');
    const insights = await analyzeWithAI(sourceData, brief, depth);
    
    // Step 3: Export results
    await job.updateProgress(80);
    console.log(`Exporting to ${exportFormat}...`);
    
    let exportResult;
    if (exportFormat === 'notion' && notionKey && notionDatabaseId) {
      exportResult = await exportToNotion(insights, {
        notionKey,
        notionDatabaseId
      });
    } else {
      // For now, just return the insights
      exportResult = {
        format: exportFormat,
        data: insights
      };
    }
    
    await job.updateProgress(100);
    console.log(`Research job ${job.id} completed!`);
    
    return {
      success: true,
      insights,
      export: exportResult
    };
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);
    throw error;
  }
}, {
  connection,
  concurrency: 5,
  removeOnComplete: {
    count: 100
  },
  removeOnFail: {
    count: 50
  }
});

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Worker shutting down...');
  await worker.close();
  process.exit(0);
});

console.log('Research worker started and listening for jobs...');