import { BaseExportPlugin } from '../base.js';
import { AnalysisResult, ExportContext, ExportResult } from '../types.js';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Markdown export plugin
 * Generates well-formatted markdown reports
 */
export default class MarkdownExportPlugin extends BaseExportPlugin {
  id = 'markdown';
  name = 'Markdown Export';
  description = 'Export research results as a formatted Markdown document';
  format = 'markdown';
  
  /**
   * Export analysis to markdown
   */
  protected async doExport(
    analysis: AnalysisResult,
    context: ExportContext
  ): Promise<ExportResult> {
    try {
      // Generate markdown content
      const markdown = this.generateMarkdown(analysis);
      
      // Determine output path
      const outputDir = context.options?.outputDir || process.env.EXPORT_DIR || './exports';
      const filename = `research-${analysis.id}-${Date.now()}.md`;
      const filepath = join(outputDir, filename);
      
      // Ensure directory exists
      await fs.mkdir(outputDir, { recursive: true });
      
      // Write file
      await fs.writeFile(filepath, markdown, 'utf8');
      
      this.logger.info({ filepath }, 'Markdown export completed');
      
      return {
        success: true,
        format: this.format,
        location: filepath,
        data: { 
          content: markdown,
          wordCount: markdown.split(/\s+/).length,
          size: Buffer.byteLength(markdown, 'utf8')
        }
      };
    } catch (error) {
      this.logger.error({ error }, 'Markdown export failed');
      throw error;
    }
  }
  
  /**
   * Generate formatted markdown from analysis
   */
  private generateMarkdown(analysis: AnalysisResult): string {
    const sections: string[] = [];
    
    // Title and metadata
    sections.push(`# Research Report: ${analysis.query}`);
    sections.push('');
    sections.push(`**Generated:** ${new Date(analysis.metadata.timestamp).toLocaleString()}`);
    sections.push(`**Documents Analyzed:** ${analysis.metadata.totalDocuments}`);
    sections.push(`**Confidence Score:** ${(analysis.metadata.confidence * 100).toFixed(0)}%`);
    sections.push('');
    sections.push('---');
    sections.push('');
    
    // Executive Summary
    sections.push('## Executive Summary');
    sections.push('');
    sections.push(analysis.summary);
    sections.push('');
    
    // Key Insights
    if (analysis.insights.length > 0) {
      sections.push('## Key Insights');
      sections.push('');
      
      // Group insights by category
      const insightsByCategory = this.groupInsightsByCategory(analysis.insights);
      
      for (const [category, insights] of Object.entries(insightsByCategory)) {
        sections.push(`### ${this.formatCategoryName(category)}`);
        sections.push('');
        
        for (const insight of insights) {
          sections.push(`#### ${insight.title}`);
          sections.push('');
          sections.push(`**Importance:** ${this.formatImportance(insight.importance)}`);
          sections.push('');
          sections.push(insight.description);
          sections.push('');
          
          if (insight.evidence.length > 0) {
            sections.push('**Supporting Evidence:**');
            sections.push('');
            for (const evidence of insight.evidence) {
              sections.push(`> ${evidence.excerpt}`);
              sections.push('');
            }
          }
        }
      }
    }
    
    // Recommendations
    if (analysis.recommendations.length > 0) {
      sections.push('## Recommendations');
      sections.push('');
      
      analysis.recommendations.forEach((rec, index) => {
        sections.push(`${index + 1}. ${rec}`);
      });
      sections.push('');
    }
    
    // Sources
    sections.push('## Sources');
    sections.push('');
    sections.push(`*Analysis based on ${analysis.metadata.totalDocuments} documents from the following sources:*`);
    sections.push('');
    
    // Group sources by metadata.source
    const sourceGroups = this.groupSourcesByType(analysis.sources);
    
    for (const [source, documents] of Object.entries(sourceGroups)) {
      sections.push(`### ${this.formatSourceName(source)}`);
      sections.push('');
      
      documents.forEach((doc, index) => {
        if (doc.url) {
          sections.push(`${index + 1}. [${doc.title}](${doc.url})`);
        } else {
          sections.push(`${index + 1}. ${doc.title}`);
        }
      });
      sections.push('');
    }
    
    // Footer
    sections.push('---');
    sections.push('');
    sections.push('*This report was generated automatically by the Research Engine.*');
    sections.push(`*Report ID: ${analysis.id}*`);
    
    return sections.join('\n');
  }
  
  /**
   * Group insights by category
   */
  private groupInsightsByCategory(insights: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    
    for (const insight of insights) {
      const category = insight.category || 'general';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(insight);
    }
    
    return groups;
  }
  
  /**
   * Group sources by type
   */
  private groupSourcesByType(sources: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    
    for (const source of sources) {
      const type = source.metadata?.source || 'unknown';
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(source);
    }
    
    return groups;
  }
  
  /**
   * Format category name for display
   */
  private formatCategoryName(category: string): string {
    return category
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  /**
   * Format source name for display
   */
  private formatSourceName(source: string): string {
    const sourceNames: Record<string, string> = {
      'github': 'GitHub',
      'websearch': 'Web Search',
      'reddit': 'Reddit',
      'stackoverflow': 'Stack Overflow',
      'unknown': 'Other Sources'
    };
    
    return sourceNames[source] || source;
  }
  
  /**
   * Format importance level
   */
  private formatImportance(importance: string): string {
    const icons: Record<string, string> = {
      'high': '🔴 High',
      'medium': '🟡 Medium',
      'low': '🟢 Low'
    };
    
    return icons[importance] || importance;
  }
  
  /**
   * Validate configuration (optional for markdown)
   */
  validateConfig(_config: Record<string, any>): boolean {
    // Markdown export doesn't require specific config
    return true;
  }
}