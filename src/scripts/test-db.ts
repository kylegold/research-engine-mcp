#!/usr/bin/env node
/**
 * Test script to verify database initialization
 * Run with: npx tsx src/scripts/test-db.ts
 */

import { createJob, getJob, getNextJob, updateJobProgress, completeJob, closeDatabase } from '../services/simpleQueue.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('test-db');

async function testDatabase() {
  try {
    logger.info('Testing database initialization...');

    // Test 1: Create a job
    logger.info('Creating test job...');
    const { id, status } = await createJob({
      brief: 'Test research brief',
      depth: 'quick',
      sources: ['web'],
      userId: 'test-user'
    });
    logger.info({ id, status }, 'Job created successfully');

    // Test 2: Get the job
    logger.info('Retrieving job...');
    const job = await getJob(id);
    if (!job) {
      throw new Error('Failed to retrieve job');
    }
    logger.info({ job }, 'Job retrieved successfully');

    // Test 3: Get next job for processing
    logger.info('Getting next job...');
    const nextJob = await getNextJob();
    if (!nextJob || nextJob.id !== id) {
      throw new Error('Failed to get next job');
    }
    logger.info({ status: nextJob.status }, 'Job marked as processing');

    // Test 4: Update progress
    logger.info('Updating job progress...');
    await updateJobProgress(id, 50, 'Processing data...', { step: 'analysis' });
    const updatedJob = await getJob(id);
    if (!updatedJob || updatedJob.progress !== 50) {
      throw new Error('Failed to update job progress');
    }
    logger.info({ progress: updatedJob.progress }, 'Progress updated successfully');

    // Test 5: Complete the job
    logger.info('Completing job...');
    await completeJob(id, { result: 'Test completed successfully' });
    const completedJob = await getJob(id);
    if (!completedJob || completedJob.status !== 'completed') {
      throw new Error('Failed to complete job');
    }
    logger.info({ status: completedJob.status }, 'Job completed successfully');

    logger.info('All database tests passed! ✅');

  } catch (error) {
    logger.error({ error }, 'Database test failed');
    process.exit(1);
  } finally {
    // Clean up
    closeDatabase();
  }
}

// Run the test
testDatabase().catch((error) => {
  logger.error({ error }, 'Unhandled error in test');
  process.exit(1);
});