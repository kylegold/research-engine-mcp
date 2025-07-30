import { Document, AnalysisResult, Insight } from '../plugins/types.js';
import { createLogger } from '../utils/logger.js';
import OpenAI from 'openai';
import { encode } from 'gpt-tokenizer';

const logger = createLogger('analyzer');

/**
 * Production-ready AI analyzer using OpenAI
 * Implements chunking, caching, and error handling
 */
export class AIAnalyzer {
  private openai: OpenAI;
  private cache = new Map<string, AnalysisResult>();
  
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Analyze documents with intelligent chunking and synthesis
   */
  async analyze(
    documents: Document[],
    query: string,
    depth: 'quick' | 'standard' | 'deep' = 'standard'
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(documents, query);
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.info({ query }, 'Returning cached analysis');
      return cached;
    }

    try {
      // Prepare documents for analysis
      const preparedDocs = this.prepareDocuments(documents, depth);
      
      // Generate analysis prompt
      const systemPrompt = this.getSystemPrompt(depth);
      const userPrompt = this.getUserPrompt(query, preparedDocs);
      
      // Call OpenAI with structured output
      const response = await this.openai.chat.completions.create({
        model: depth === 'deep' ? 'gpt-4-turbo-preview' : 'gpt-3.5-turbo-16k',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: depth === 'deep' ? 4000 : 2000,
        response_format: { type: 'json_object' }
      });

      const analysisData = JSON.parse(response.choices[0].message.content || '{}');
      
      // Build analysis result
      const result: AnalysisResult = {
        id: `analysis-${Date.now()}`,
        query,
        summary: analysisData.summary || 'No summary generated',
        insights: this.extractInsights(analysisData.insights || [], documents),
        recommendations: analysisData.recommendations || [],
        sources: this.selectTopSources(documents, analysisData.citations || []),
        metadata: {
          totalDocuments: documents.length,
          analysisDuration: Date.now() - startTime,
          confidence: this.calculateConfidence(documents, analysisData),
          timestamp: new Date().toISOString()
        }
      };

      // Cache result
      this.cache.set(cacheKey, result);
      
      // Expire cache after 1 hour
      setTimeout(() => this.cache.delete(cacheKey), 3600000);
      
      return result;
    } catch (error) {
      logger.error({ error, query }, 'Analysis failed');
      throw new Error(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Prepare documents for analysis with token limits
   */
  private prepareDocuments(
    documents: Document[],
    depth: 'quick' | 'standard' | 'deep'
  ): string {
    const maxTokens = {
      quick: 2000,
      standard: 6000,
      deep: 12000
    }[depth];

    let content = '';
    let currentTokens = 0;

    // Sort by relevance score
    const sorted = [...documents].sort((a, b) => 
      (b.metadata.relevanceScore || 0) - (a.metadata.relevanceScore || 0)
    );

    for (const doc of sorted) {
      const docText = `\n---\nSource: ${doc.metadata.source}\nTitle: ${doc.title}\nURL: ${doc.url || 'N/A'}\nContent: ${doc.content.substring(0, 2000)}\n`;
      const tokens = encode(docText).length;
      
      if (currentTokens + tokens > maxTokens) break;
      
      content += docText;
      currentTokens += tokens;
    }

    return content;
  }

  /**
   * Get system prompt based on depth
   */
  private getSystemPrompt(depth: 'quick' | 'standard' | 'deep'): string {
    const basePrompt = `You are an expert research analyst. Analyze the provided documents and generate a comprehensive analysis in JSON format with the following structure:
{
  "summary": "Executive summary of findings",
  "insights": [
    {
      "category": "trend|fact|opinion|warning",
      "title": "Insight title",
      "description": "Detailed description",
      "importance": "high|medium|low",
      "evidence": ["doc_id1", "doc_id2"]
    }
  ],
  "recommendations": ["Actionable recommendation 1", "Recommendation 2"],
  "citations": ["doc_id1", "doc_id2"]
}`;

    const depthInstructions = {
      quick: '\nProvide a quick overview focusing on key findings.',
      standard: '\nProvide a balanced analysis with moderate detail.',
      deep: '\nProvide an exhaustive analysis with comprehensive insights and cross-references.'
    };

    return basePrompt + depthInstructions[depth];
  }

  /**
   * Build user prompt with query and documents
   */
  private getUserPrompt(query: string, documents: string): string {
    return `Research Query: ${query}\n\nDocuments to analyze:\n${documents}`;
  }

  /**
   * Extract and enrich insights
   */
  private extractInsights(rawInsights: any[], documents: Document[]): Insight[] {
    return rawInsights.map((insight, index) => ({
      id: `insight-${index}`,
      category: insight.category || 'general',
      title: insight.title || 'Untitled Insight',
      description: insight.description || '',
      importance: insight.importance || 'medium',
      evidence: (insight.evidence || []).map((docId: string) => {
        const doc = documents.find(d => d.id === docId);
        return doc ? {
          documentId: doc.id,
          excerpt: doc.content.substring(0, 200) + '...'
        } : null;
      }).filter(Boolean)
    }));
  }

  /**
   * Select top sources based on citations and relevance
   */
  private selectTopSources(documents: Document[], citations: string[]): Document[] {
    const cited = documents.filter(d => citations.includes(d.id));
    const uncited = documents.filter(d => !citations.includes(d.id));
    
    // Return cited docs + top uncited by relevance
    return [
      ...cited,
      ...uncited.sort((a, b) => 
        (b.metadata.relevanceScore || 0) - (a.metadata.relevanceScore || 0)
      ).slice(0, Math.max(0, 10 - cited.length))
    ].slice(0, 10);
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(documents: Document[], analysisData: any): number {
    const factors = {
      documentCount: Math.min(documents.length / 10, 1) * 0.3,
      sourceDiv diversity: new Set(documents.map(d => d.metadata.source)).size / 5 * 0.2,
      hasInsights: (analysisData.insights?.length > 0 ? 1 : 0) * 0.3,
      hasCitations: (analysisData.citations?.length > 0 ? 1 : 0) * 0.2
    };

    return Math.min(Object.values(factors).reduce((a, b) => a + b, 0), 1);
  }

  /**
   * Generate cache key
   */
  private getCacheKey(documents: Document[], query: string): string {
    const docIds = documents.map(d => d.id).sort().join(',');
    return `${query}-${docIds}`.substring(0, 100);
  }
}