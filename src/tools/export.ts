import { z } from 'zod';
import type { Tool } from '../types.js';
import { researchApi } from '../services/researchApi.js';

// Input schema for research_export
const ResearchExportSchema = z.object({
  jobId: z.string().min(1).describe('The job ID to export'),
  format: z.enum(['notion', 'markdown', 'json']).default('markdown')
});

export const researchExportTool: Tool = {
  name: 'research_export',
  description: 'Export completed research results',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'The job ID to export'
      },
      format: {
        type: 'string',
        enum: ['notion', 'markdown', 'json'],
        description: 'Export format: notion, markdown, or json',
        default: 'markdown'
      }
    },
    required: ['jobId']
  },
  handler: async (args, _context) => {
    try {
      // Validate input
      const input = ResearchExportSchema.parse(args);
      
      // First check if job is completed
      const status = await researchApi.getJobStatus(input.jobId);
      
      if (status.status !== 'completed') {
        return {
          success: false,
          message: `Cannot export: Research job is ${status.status}. Please wait for completion.`,
          currentStatus: status.status,
          progress: status.progress
        };
      }
      
      // Export the results
      const exportResult = await researchApi.exportJob({
        jobId: input.jobId,
        format: input.format
      });

      if (!exportResult.success) {
        throw new Error(exportResult.error || 'Export failed');
      }

      // Format response based on export type
      const response: any = {
        success: true,
        jobId: input.jobId,
        format: input.format,
        message: `Research exported successfully as ${input.format}!`
      };

      if (input.format === 'notion' && exportResult.notionPageId) {
        response.notionPageId = exportResult.notionPageId;
        response.notionUrl = `https://notion.so/${exportResult.notionPageId.replace(/-/g, '')}`;
        response.message = 'Research exported to your Notion workspace!';
      } else if (exportResult.exportUrl) {
        response.downloadUrl = exportResult.exportUrl;
        response.expiresIn = '1 hour';
      } else if (exportResult.data) {
        response.data = exportResult.data;
      }

      return response;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid input: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  }
};