// This file is now deprecated - we use queue.ts instead
// Keeping for backwards compatibility during migration

import type { 
  ResearchJobRequest, 
  ResearchJobResponse, 
  ResearchStatusResponse,
  ResearchExportRequest,
  ResearchExportResponse 
} from '../types.js';
import { createResearchJob, getJobStatus } from './queue.js';

export class ResearchApiClient {
  async createJob(request: ResearchJobRequest): Promise<ResearchJobResponse> {
    // Now uses local queue instead of external API
    const result = await createResearchJob(request);
    return {
      ...result,
      estimatedTime: result.estimatedTime
    };
  }

  async getJobStatus(jobId: string): Promise<ResearchStatusResponse> {
    // Now uses local queue instead of external API
    const status = await getJobStatus(jobId);
    return status as ResearchStatusResponse;
  }

  async exportJob(request: ResearchExportRequest): Promise<ResearchExportResponse> {
    // Export is now handled by the worker, so we just check status
    const status = await getJobStatus(request.jobId);
    
    if (status.status !== 'completed') {
      return {
        success: false,
        error: 'Job not completed yet'
      };
    }
    
    return {
      success: true,
      data: status.result
    };
  }

  getEstimatedTime(depth: string = 'standard'): string {
    const estimates = {
      'quick': '5-10 minutes',
      'standard': '15-30 minutes',
      'deep': '45-60 minutes'
    };
    return estimates[depth as keyof typeof estimates] || estimates.standard;
  }
}

export const researchApi = new ResearchApiClient();