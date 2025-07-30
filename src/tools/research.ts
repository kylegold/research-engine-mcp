import { z } from 'zod';
import type { Tool } from '../types.js';
import { researchApi } from '../services/researchApi.js';

// Input schema for research_brief
const ResearchBriefSchema = z.object({
  brief: z.string().min(10).describe('Natural language description of what you want to research'),
  depth: z.enum(['quick', 'standard', 'deep']).optional().default('standard'),
  sources: z.array(z.string()).optional().default(['github', 'reddit']),
  exportFormat: z.enum(['notion', 'markdown', 'json']).optional().default('markdown'),
  notionKey: z.string().optional(),
  notionDatabaseId: z.string().optional()
});

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
        description: 'Research depth: quick (5-10min), standard (15-30min), deep (45-60min)',
        default: 'standard'
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Preferred sources to search (github, reddit, stackoverflow)',
        default: ['github', 'reddit']
      },
      exportFormat: {
        type: 'string',
        enum: ['notion', 'markdown', 'json'],
        description: 'Export format for results',
        default: 'markdown'
      },
      notionKey: {
        type: 'string',
        description: 'Your Notion API key (required if export format is notion)'
      },
      notionDatabaseId: {
        type: 'string',
        description: 'Your Notion database ID (required if export format is notion)'
      }
    },
    required: ['brief']
  },
  handler: async (args, context) => {
    try {
      // Validate input
      const input = ResearchBriefSchema.parse(args);
      
      // Validate Notion credentials if needed
      if (input.exportFormat === 'notion' && (!input.notionKey || !input.notionDatabaseId)) {
        throw new Error('Notion API key and database ID are required when export format is notion');
      }
      
      // Create research job
      const response = await researchApi.createJob({
        brief: input.brief,
        depth: input.depth,
        sources: input.sources,
        userId: context.user?.id,
        exportFormat: input.exportFormat,
        notionKey: input.notionKey,
        notionDatabaseId: input.notionDatabaseId
      });

      return {
        success: true,
        jobId: response.jobId,
        message: `Research job started! Check status with research_status tool using jobId: ${response.jobId}`,
        estimatedTime: researchApi.getEstimatedTime(input.depth),
        details: {
          brief: input.brief,
          depth: input.depth,
          sources: input.sources
        }
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid input: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  }
};