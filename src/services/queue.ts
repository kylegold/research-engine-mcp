import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Create queue
export const researchQueue = new Queue('research', { connection });

export interface CreateJobOptions {
  brief: string;
  depth?: 'quick' | 'standard' | 'deep';
  sources?: string[];
  userId?: string;
  exportFormat?: 'notion' | 'markdown' | 'json';
  exportCredentials?: Record<string, any>;
}

export async function createResearchJob(options: CreateJobOptions) {
  const jobId = uuidv4();
  
  const job = await researchQueue.add('research-task', options, {
    jobId,
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });
  
  return {
    jobId: job.id,
    status: 'queued' as const,
    message: 'Research job created successfully',
    estimatedTime: getEstimatedTime(options.depth)
  };
}

export async function getJobStatus(jobId: string) {
  const job = await researchQueue.getJob(jobId);
  
  if (!job) {
    throw new Error('Job not found');
  }
  
  const state = await job.getState();
  const progress = job.progress;
  
  if (state === 'completed') {
    return {
      jobId: job.id,
      status: 'completed' as const,
      progress: 100,
      result: job.returnvalue,
      completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined
    };
  } else if (state === 'failed') {
    return {
      jobId: job.id,
      status: 'failed' as const,
      error: job.failedReason,
      progress: progress || 0
    };
  } else {
    return {
      jobId: job.id,
      status: state as 'active' | 'waiting' | 'delayed',
      progress: progress || 0,
      currentStage: typeof progress === 'object' ? (progress as any).stage : 'Processing'
    };
  }
}

function getEstimatedTime(depth?: string): string {
  const estimates = {
    'quick': '5-10 minutes',
    'standard': '15-30 minutes',
    'deep': '45-60 minutes'
  };
  return estimates[depth as keyof typeof estimates] || estimates.standard;
}