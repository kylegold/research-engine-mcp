import type { Tool } from '../types.js';

export const researchBriefTool: Tool = {
  name: 'research_brief',
  description: 'Submit a research brief for automated analysis',
  inputSchema: {
    type: 'object',
    properties: {
      brief: {
        type: 'string',
        description: 'Natural language description of what you want to research',
        minLength: 10
      },
      depth: {
        type: 'string',
        enum: ['quick', 'standard', 'deep'],
        description: 'Research depth: quick (2-3min), standard (5-7min), deep (10-15min)',
        default: 'standard'
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Preferred sources to search (github, websearch)',
        default: ['github', 'websearch']
      },
      exportFormat: {
        type: 'string',
        enum: ['notion', 'markdown', 'json'],
        description: 'Export format for results',
        default: 'markdown'
      },
      exportCredentials: {
        type: 'object',
        description: 'Credentials for export plugin (e.g., notionKey, notionDatabaseId)',
        additionalProperties: true
      }
    },
    required: ['brief']
  },
  handler: async () => {
    // The actual job submission is handled in index.ts
    // This handler is called but the real work happens in the main server
    return {
      info: 'Job submission handled by main server'
    };
  }
};