import { BaseExportPlugin } from '../base.js';
import { AnalysisResult, ExportContext, ExportResult } from '../types.js';
import { Client } from '@notionhq/client';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('notion-export');

/**
 * Production-ready Notion export plugin
 * Creates beautiful research pages in Notion
 */
export class NotionExportPlugin extends BaseExportPlugin {
  id = 'notion';
  name = 'Notion Export';
  description = 'Export research results to Notion';
  format = 'notion';

  /**
   * Validate Notion configuration
   */
  validateConfig(config: Record<string, any>): boolean {
    return !!(config.token && config.databaseId);
  }

  /**
   * Export analysis to Notion
   */
  protected async doExport(
    analysis: AnalysisResult,
    context: ExportContext
  ): Promise<ExportResult> {
    try {
      if (!context.credentials?.token || !context.credentials?.databaseId) {
        throw new Error('Notion credentials required: token and databaseId');
      }

      const notion = new Client({
        auth: context.credentials.token
      });

      // Create the main research page
      const page = await this.createResearchPage(
        notion,
        analysis,
        context.credentials.databaseId
      );

      // Add content blocks
      await this.addContentBlocks(notion, page.id, analysis);

      logger.info({ pageId: page.id }, 'Successfully exported to Notion');

      return {
        success: true,
        format: 'notion',
        location: page.url,
        data: { pageId: page.id }
      };
    } catch (error) {
      logger.error({ error }, 'Notion export failed');
      return {
        success: false,
        format: 'notion',
        error: error instanceof Error ? error.message : 'Export failed'
      };
    }
  }

  /**
   * Create the main research page
   */
  private async createResearchPage(
    notion: Client,
    analysis: AnalysisResult,
    databaseId: string
  ): Promise<any> {
    const page = await notion.pages.create({
      parent: { database_id: databaseId },
      icon: { emoji: '🔬' },
      properties: {
        title: {
          title: [
            {
              text: {
                content: `Research: ${analysis.query}`
              }
            }
          ]
        },
        Status: {
          select: {
            name: 'Completed'
          }
        },
        Date: {
          date: {
            start: analysis.metadata.timestamp
          }
        },
        'Document Count': {
          number: analysis.metadata.totalDocuments
        },
        Confidence: {
          number: Math.round(analysis.metadata.confidence * 100)
        }
      }
    });

    return page;
  }

  /**
   * Add content blocks to the page
   */
  private async addContentBlocks(
    notion: Client,
    pageId: string,
    analysis: AnalysisResult
  ): Promise<void> {
    const blocks: any[] = [];

    // Executive Summary
    blocks.push(
      {
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ text: { content: '📋 Executive Summary' } }]
        }
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: analysis.summary } }]
        }
      },
      {
        object: 'block',
        type: 'divider',
        divider: {}
      }
    );

    // Key Insights
    if (analysis.insights.length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ text: { content: '💡 Key Insights' } }]
        }
      });

      for (const insight of analysis.insights) {
        const emoji = {
          high: '🔴',
          medium: '🟡',
          low: '🟢'
        }[insight.importance];

        blocks.push(
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ text: { content: `${emoji} ${insight.title}` } }]
            }
          },
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: insight.description } }]
            }
          }
        );

        // Add evidence as bullet points
        if (insight.evidence.length > 0) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ 
                text: { 
                  content: 'Supporting evidence:',
                  annotations: { italic: true }
                } 
              }]
            }
          });

          for (const evidence of insight.evidence.slice(0, 3)) {
            blocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ text: { content: evidence.excerpt } }]
              }
            });
          }
        }
      }

      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ text: { content: '🎯 Recommendations' } }]
        }
      });

      for (const recommendation of analysis.recommendations) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ text: { content: recommendation } }]
          }
        });
      }

      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
    }

    // Sources
    blocks.push({
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{ text: { content: '📚 Sources' } }]
      }
    });

    for (const source of analysis.sources.slice(0, 10)) {
      blocks.push({
        object: 'block',
        type: 'bookmark',
        bookmark: {
          url: source.url || 'https://example.com',
          caption: [
            {
              text: {
                content: `${source.title} - ${source.metadata.source}`
              }
            }
          ]
        }
      });
    }

    // Metadata
    blocks.push(
      {
        object: 'block',
        type: 'divider',
        divider: {}
      },
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { emoji: '📊' },
          rich_text: [
            {
              text: {
                content: `Analysis completed in ${Math.round(analysis.metadata.analysisDuration / 1000)}s • ${analysis.metadata.totalDocuments} documents analyzed • Confidence: ${Math.round(analysis.metadata.confidence * 100)}%`
              }
            }
          ]
        }
      }
    );

    // Append all blocks
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks
    });
  }
}

export default NotionExportPlugin;