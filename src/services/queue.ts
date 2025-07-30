import * as simpleQueue from './simpleQueue.js';

export interface CreateJobOptions {
  brief: string;
  depth?: 'quick' | 'standard' | 'deep';
  sources?: string[];
  userId?: string;
  exportFormat?: 'notion' | 'markdown' | 'json';
  exportCredentials?: Record<string, any>;
}

export async function createResearchJob(options: CreateJobOptions) {
  const result = await simpleQueue.createJob(options);
  
  return {
    jobId: result.id,
    status: 'queued' as const,
    message: 'Research job created successfully',
    estimatedTime: getEstimatedTime(options.depth)
  };
}

export async function getJobStatus(jobId: string) {
  const job = await simpleQueue.getJob(jobId);
  
  if (!job) {
    throw new Error('Job not found');
  }
  
  // Map our internal status to the expected format
  if (job.status === 'completed' && job.result) {
    return {
      jobId: job.id,
      status: 'completed' as const,
      progress: 100,
      result: job.result,
      completedAt: job.completedAt?.toISOString()
    };
  } else if (job.status === 'failed') {
    return {
      jobId: job.id,
      status: 'failed' as const,
      error: job.error,
      progress: job.progress || 0
    };
  } else if (job.status === 'processing') {
    return {
      jobId: job.id,
      status: 'active' as const,
      progress: job.progress || 0,
      currentStage: job.currentStep || 'Processing'
    };
  } else {
    return {
      jobId: job.id,
      status: 'waiting' as const,
      progress: 0,
      currentStage: 'Queued'
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

// Re-export queue functions for compatibility
export const researchQueue = {
  add: async (_name: string, data: any) => {
    const result = await simpleQueue.createJob(data);
    return { id: result.id };
  },
  getJob: async (id: string) => {
    const job = await simpleQueue.getJob(id);
    if (!job) return null;
    
    return {
      id: job.id,
      data: job.data,
      progress: job.progress,
      returnvalue: job.result,
      failedReason: job.error,
      finishedOn: job.completedAt?.getTime(),
      attemptsMade: job.attempts,
      opts: { attempts: 3 },
      getState: async () => {
        if (job.status === 'completed') return 'completed';
        if (job.status === 'failed') return 'failed';
        if (job.status === 'processing') return 'active';
        return 'waiting';
      },
      updateProgress: async (progress: number | any) => {
        if (typeof progress === 'number') {
          await simpleQueue.updateJobProgress(job.id, progress);
        } else if (progress && typeof progress === 'object') {
          await simpleQueue.updateJobProgress(
            job.id, 
            progress.progress || 0, 
            progress.stage
          );
        }
      }
    };
  }
};