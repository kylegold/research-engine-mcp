import { z } from 'zod';
import type { Tool } from '../types.js';
import { researchApi } from '../services/researchApi.js';

// Input schema for research_status
const ResearchStatusSchema = z.object({
  jobId: z.string().min(1).describe('The job ID returned from research_brief')
});

export const researchStatusTool: Tool = {
  name: 'research_status',
  description: 'Check the status of a research job',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'The job ID returned from research_brief'
      }
    },
    required: ['jobId']
  },
  handler: async (args) => {
    try {
      // Validate input
      const input = ResearchStatusSchema.parse(args);
      
      // Get job status
      const status = await researchApi.getJobStatus(input.jobId);

      // Format response based on status
      if (status.status === 'completed') {
        return {
          success: true,
          jobId: status.jobId,
          status: status.status,
          message: 'Research completed successfully!',
          result: status.result,
          completedAt: status.completedAt,
          nextStep: 'Use research_export to download results in your preferred format'
        };
      } else if (status.status === 'failed') {
        return {
          success: false,
          jobId: status.jobId,
          status: status.status,
          error: status.error || 'Research job failed',
          message: 'The research job encountered an error'
        };
      } else {
        // Still processing
        return {
          success: true,
          jobId: status.jobId,
          status: status.status,
          progress: status.progress || 0,
          currentStage: status.currentStage || 'Initializing',
          message: `Research in progress: ${status.currentStage || 'Processing'}`,
          hint: 'Check back in a few minutes or use this jobId to poll for updates'
        };
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid input: ${error.errors.map(e => e.message).join(', ')}`);
      }
      if (error instanceof Error && error.message.includes('not found')) {
        throw new Error(`Research job not found. Please check the jobId.`);
      }
      throw error;
    }
  }
};