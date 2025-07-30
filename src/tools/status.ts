import type { Tool } from '../types.js';

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
    // Status checking is handled by the main server via HTTP endpoint
    // This handler returns a placeholder
    return {
      info: 'Status checking handled by main server',
      jobId: args.jobId
    };
  }
};