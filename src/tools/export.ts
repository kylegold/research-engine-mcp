import type { Tool } from '../types.js';

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
  handler: async (args) => {
    // Export handling is done by the main server
    return {
      info: 'Export handled by main server',
      jobId: args.jobId,
      format: args.format || 'markdown'
    };
  }
};