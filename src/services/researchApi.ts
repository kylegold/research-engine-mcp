import fetch from 'node-fetch';
import type { 
  ResearchJobRequest, 
  ResearchJobResponse, 
  ResearchStatusResponse,
  ResearchExportRequest,
  ResearchExportResponse 
} from '../types.js';

const API_URL = process.env.RESEARCH_API_URL || 'http://localhost:4000';
const API_KEY = process.env.RESEARCH_API_KEY || 'dev-key';

export class ResearchApiClient {
  private headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  async createJob(request: ResearchJobRequest): Promise<ResearchJobResponse> {
    try {
      const response = await fetch(`${API_URL}/api/jobs`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`Research API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as ResearchJobResponse;
    } catch (error) {
      console.error('Failed to create research job:', error);
      throw new Error('Failed to start research job');
    }
  }

  async getJobStatus(jobId: string): Promise<ResearchStatusResponse> {
    try {
      const response = await fetch(`${API_URL}/api/jobs/${jobId}`, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Research job not found');
        }
        throw new Error(`Research API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as ResearchStatusResponse;
    } catch (error) {
      console.error('Failed to get job status:', error);
      throw error;
    }
  }

  async exportJob(request: ResearchExportRequest): Promise<ResearchExportResponse> {
    try {
      const response = await fetch(`${API_URL}/api/jobs/${request.jobId}/export`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ format: request.format })
      });

      if (!response.ok) {
        throw new Error(`Research API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as ResearchExportResponse;
    } catch (error) {
      console.error('Failed to export research:', error);
      throw new Error('Failed to export research results');
    }
  }

  // Helper method to estimate completion time
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