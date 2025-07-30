import { BaseSourcePlugin } from '../base.js';
import { PluginContext, PluginResult, QueryContext, Document } from '../types.js';
import { CircuitBreaker } from '../../utils/circuit-breaker.js';
import { createLogger } from '../../utils/logger.js';
import fetch from 'node-fetch';
import { z } from 'zod';

const logger = createLogger('stackoverflow-plugin');

// StackOverflow API response schemas
const StackOverflowQuestionSchema = z.object({
  question_id: z.number(),
  title: z.string(),
  body: z.string().optional(),
  score: z.number(),
  answer_count: z.number(),
  accepted_answer_id: z.number().optional(),
  creation_date: z.number(),
  last_activity_date: z.number(),
  tags: z.array(z.string()),
  owner: z.object({
    display_name: z.string(),
    reputation: z.number()
  }).optional(),
  link: z.string()
});

const StackOverflowAnswerSchema = z.object({
  answer_id: z.number(),
  question_id: z.number(),
  body: z.string(),
  score: z.number(),
  is_accepted: z.boolean(),
  creation_date: z.number(),
  owner: z.object({
    display_name: z.string(),
    reputation: z.number()
  }).optional()
});

/**
 * StackOverflow source plugin with robust error handling
 */
export class StackOverflowSourcePlugin extends BaseSourcePlugin {
  private circuitBreaker: CircuitBreaker;
  private apiKey?: string;
  
  constructor() {
    super({
      id: 'stackoverflow',
      name: 'StackOverflow Search',
      description: 'Search StackOverflow for technical Q&A',
      version: '1.0.0',
      configSchema: {
        apiKey: { type: 'string', required: false }
      }
    });
    
    this.circuitBreaker = new CircuitBreaker(5, 60000);
  }

  /**
   * Initialize with optional API key for higher rate limits
   */
  async initialize(config: Record<string, any>): Promise<void> {
    this.apiKey = config.apiKey;
    logger.info(
      { hasApiKey: !!this.apiKey },
      'StackOverflow plugin initialized'
    );
  }

  /**
   * Check if this plugin should handle the query
   */
  supports(query: string, context: QueryContext): boolean {
    // Check if StackOverflow is explicitly requested
    if (context.preferences?.sources?.includes('stackoverflow')) return true;
    
    // Auto-detect technical queries
    const techKeywords = [
      'error', 'exception', 'bug', 'how to', 'implement',
      'python', 'javascript', 'java', 'code', 'programming',
      'api', 'database', 'sql', 'react', 'node'
    ];
    
    const queryLower = query.toLowerCase();
    return techKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Search StackOverflow for relevant Q&A
   */
  async search(context: PluginContext): Promise<PluginResult> {
    const startTime = Date.now();
    
    try {
      return await this.circuitBreaker.execute(async () => {
        const documents = await this.performSearch(context);
        
        return {
          success: true,
          documents,
          metadata: {
            source: this.id,
            documentsFound: documents.length,
            duration: Date.now() - startTime,
            cached: false
          }
        };
      });
    } catch (error) {
      logger.error({ error }, 'StackOverflow search failed');
      
      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        return this.createErrorResult(
          'StackOverflow API temporarily unavailable',
          'TEMP_ERROR',
          60
        );
      }
      
      return this.createErrorResult(
        error instanceof Error ? error.message : 'StackOverflow search failed'
      );
    }
  }

  /**
   * Perform the actual StackOverflow search
   */
  private async performSearch(context: PluginContext): Promise<Document[]> {
    const { query, depth = 'standard' } = context;
    const documents: Document[] = [];
    
    // Search limits based on depth
    const limits = {
      quick: { questions: 5, answers: 2 },
      standard: { questions: 10, answers: 3 },
      deep: { questions: 20, answers: 5 }
    };
    
    const limit = limits[depth];
    
    await context.updateProgress('Searching StackOverflow questions...', 20);
    
    // Search questions
    const questionsUrl = new URL('https://api.stackexchange.com/2.3/search/advanced');
    questionsUrl.searchParams.set('q', query);
    questionsUrl.searchParams.set('site', 'stackoverflow');
    questionsUrl.searchParams.set('order', 'desc');
    questionsUrl.searchParams.set('sort', 'relevance');
    questionsUrl.searchParams.set('pagesize', limit.questions.toString());
    questionsUrl.searchParams.set('filter', 'withbody');
    
    if (this.apiKey) {
      questionsUrl.searchParams.set('key', this.apiKey);
    }
    
    const questionsResponse = await fetch(questionsUrl.toString());
    const questionsData = await questionsResponse.json();
    
    if (!questionsData.items) {
      throw new Error('Invalid response from StackOverflow API');
    }
    
    await context.updateProgress('Processing questions and fetching answers...', 50);
    
    // Process questions and fetch answers
    for (const questionData of questionsData.items) {
      try {
        const question = StackOverflowQuestionSchema.parse(questionData);
        
        // Create document for question
        documents.push({
          id: `so-q-${question.question_id}`,
          title: question.title,
          content: this.formatQuestionContent(question),
          url: question.link,
          metadata: {
            source: 'stackoverflow',
            timestamp: new Date(question.creation_date * 1000).toISOString(),
            relevanceScore: this.calculateQuestionRelevance(question, query),
            type: 'question',
            score: question.score,
            answerCount: question.answer_count,
            tags: question.tags,
            hasAcceptedAnswer: !!question.accepted_answer_id
          }
        });
        
        // Fetch answers for high-value questions
        if (question.answer_count > 0 && (question.score > 5 || question.accepted_answer_id)) {
          await context.updateProgress(
            `Fetching answers for: ${question.title.substring(0, 50)}...`,
            70
          );
          
          const answers = await this.fetchAnswers(
            question.question_id,
            limit.answers,
            question.accepted_answer_id
          );
          
          for (const answer of answers) {
            documents.push({
              id: `so-a-${answer.answer_id}`,
              title: `Answer to: ${question.title}`,
              content: this.formatAnswerContent(answer, question.title),
              url: `${question.link}#${answer.answer_id}`,
              metadata: {
                source: 'stackoverflow',
                timestamp: new Date(answer.creation_date * 1000).toISOString(),
                relevanceScore: this.calculateAnswerRelevance(answer, query) * 0.9,
                type: 'answer',
                score: answer.score,
                isAccepted: answer.is_accepted,
                questionId: question.question_id
              }
            });
          }
        }
      } catch (error) {
        logger.warn({ error, questionId: questionData.question_id }, 'Failed to process question');
      }
    }
    
    await context.updateProgress('StackOverflow search complete', 100);
    
    // Sort by relevance
    return documents.sort((a, b) => 
      (b.metadata.relevanceScore || 0) - (a.metadata.relevanceScore || 0)
    );
  }

  /**
   * Fetch answers for a question
   */
  private async fetchAnswers(
    questionId: number,
    limit: number,
    acceptedAnswerId?: number
  ): Promise<z.infer<typeof StackOverflowAnswerSchema>[]> {
    const answersUrl = new URL(`https://api.stackexchange.com/2.3/questions/${questionId}/answers`);
    answersUrl.searchParams.set('site', 'stackoverflow');
    answersUrl.searchParams.set('order', 'desc');
    answersUrl.searchParams.set('sort', 'votes');
    answersUrl.searchParams.set('pagesize', limit.toString());
    answersUrl.searchParams.set('filter', 'withbody');
    
    if (this.apiKey) {
      answersUrl.searchParams.set('key', this.apiKey);
    }
    
    const response = await fetch(answersUrl.toString());
    const data = await response.json();
    
    if (!data.items) {
      return [];
    }
    
    // Parse and prioritize accepted answer
    const answers = data.items.map((item: any) => 
      StackOverflowAnswerSchema.parse(item)
    );
    
    // Sort to put accepted answer first
    if (acceptedAnswerId) {
      answers.sort((a: any, b: any) => {
        if (a.answer_id === acceptedAnswerId) return -1;
        if (b.answer_id === acceptedAnswerId) return 1;
        return b.score - a.score;
      });
    }
    
    return answers.slice(0, limit);
  }

  /**
   * Format question content
   */
  private formatQuestionContent(question: z.infer<typeof StackOverflowQuestionSchema>): string {
    const parts = [
      question.body || 'No body available',
      '',
      '---',
      `Score: ${question.score} | Answers: ${question.answer_count}`,
      `Tags: ${question.tags.join(', ')}`,
      `Asked: ${new Date(question.creation_date * 1000).toLocaleDateString()}`
    ];
    
    if (question.owner) {
      parts.push(`Author: ${question.owner.display_name} (${question.owner.reputation} rep)`);
    }
    
    return parts.join('\n');
  }

  /**
   * Format answer content
   */
  private formatAnswerContent(
    answer: z.infer<typeof StackOverflowAnswerSchema>,
    questionTitle: string
  ): string {
    const parts = [
      answer.body,
      '',
      '---',
      `Score: ${answer.score}${answer.is_accepted ? ' ✓ Accepted' : ''}`,
      `Answered: ${new Date(answer.creation_date * 1000).toLocaleDateString()}`
    ];
    
    if (answer.owner) {
      parts.push(`Author: ${answer.owner.display_name} (${answer.owner.reputation} rep)`);
    }
    
    return parts.join('\n');
  }

  /**
   * Calculate question relevance score
   */
  private calculateQuestionRelevance(
    question: z.infer<typeof StackOverflowQuestionSchema>,
    query: string
  ): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const content = (question.title + ' ' + (question.body || '')).toLowerCase();
    
    // Term frequency
    let matches = 0;
    for (const term of queryTerms) {
      if (content.includes(term)) matches++;
    }
    const termScore = matches / queryTerms.length;
    
    // Quality indicators
    const scoreWeight = Math.min(question.score / 100, 1) * 0.2;
    const answerWeight = Math.min(question.answer_count / 10, 1) * 0.1;
    const acceptedWeight = question.accepted_answer_id ? 0.2 : 0;
    
    // Tag relevance
    const tagRelevance = question.tags.some(tag => 
      queryTerms.some(term => tag.includes(term))
    ) ? 0.1 : 0;
    
    return termScore * 0.4 + scoreWeight + answerWeight + acceptedWeight + tagRelevance;
  }

  /**
   * Calculate answer relevance score
   */
  private calculateAnswerRelevance(
    answer: z.infer<typeof StackOverflowAnswerSchema>,
    query: string
  ): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const content = answer.body.toLowerCase();
    
    // Term frequency
    let matches = 0;
    for (const term of queryTerms) {
      if (content.includes(term)) matches++;
    }
    const termScore = matches / queryTerms.length;
    
    // Quality indicators
    const scoreWeight = Math.min(answer.score / 50, 1) * 0.3;
    const acceptedWeight = answer.is_accepted ? 0.4 : 0;
    
    return termScore * 0.3 + scoreWeight + acceptedWeight;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    logger.info('StackOverflow plugin disposed');
  }
}

export default StackOverflowSourcePlugin;