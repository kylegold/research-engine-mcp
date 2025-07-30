import { BaseSourcePlugin } from '../base.js';
import { PluginContext, PluginResult, QueryContext, Document } from '../types.js';
import { CircuitBreaker } from '../../utils/circuit-breaker.js';
import { createLogger } from '../../utils/logger.js';
import snoowrap from 'snoowrap';

const logger = createLogger('reddit-plugin');

/**
 * Reddit source plugin with circuit breaker and rate limiting
 */
export class RedditSourcePlugin extends BaseSourcePlugin {
  private reddit?: snoowrap;
  private circuitBreaker: CircuitBreaker;
  
  constructor() {
    super({
      id: 'reddit',
      name: 'Reddit Search',
      description: 'Search Reddit posts and comments for insights',
      version: '1.0.0',
      configSchema: {
        clientId: { type: 'string', required: true },
        clientSecret: { type: 'string', required: true },
        userAgent: { type: 'string', default: 'research-engine:1.0.0' }
      }
    });
    
    this.circuitBreaker = new CircuitBreaker(3, 60000);
  }

  /**
   * Initialize Reddit client
   */
  async initialize(config: Record<string, any>): Promise<void> {
    if (!config.clientId || !config.clientSecret) {
      logger.warn('Reddit credentials not configured');
      return;
    }

    this.reddit = new snoowrap({
      userAgent: config.userAgent || 'research-engine:1.0.0',
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken
    });

    logger.info('Reddit plugin initialized');
  }

  /**
   * Check if this plugin should handle the query
   */
  supports(query: string, context: QueryContext): boolean {
    // Skip if not initialized
    if (!this.reddit) return false;
    
    // Check if Reddit is explicitly requested
    if (context.preferences?.sources?.includes('reddit')) return true;
    
    // Auto-detect Reddit-related queries
    const redditKeywords = ['reddit', 'subreddit', '/r/', 'redditors'];
    return redditKeywords.some(keyword => 
      query.toLowerCase().includes(keyword)
    );
  }

  /**
   * Search Reddit for relevant content
   */
  async search(context: PluginContext): Promise<PluginResult> {
    const startTime = Date.now();
    
    if (!this.reddit) {
      return this.createErrorResult('Reddit client not initialized');
    }

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
      logger.error({ error }, 'Reddit search failed');
      
      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        return this.createErrorResult('Reddit API temporarily unavailable', 'TEMP_ERROR', 60);
      }
      
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Reddit search failed'
      );
    }
  }

  /**
   * Perform the actual Reddit search
   */
  private async performSearch(context: PluginContext): Promise<Document[]> {
    const { query, depth = 'standard' } = context;
    const documents: Document[] = [];
    
    // Update progress
    await context.updateProgress('Searching Reddit posts...', 20);
    
    // Search parameters based on depth
    const limits = {
      quick: { posts: 10, comments: 5 },
      standard: { posts: 25, comments: 10 },
      deep: { posts: 50, comments: 20 }
    };
    
    const limit = limits[depth];
    
    // Search posts
    const posts = await this.reddit!.search({
      query,
      sort: 'relevance',
      time: 'all',
      limit: limit.posts
    });
    
    await context.updateProgress('Processing Reddit posts...', 50);
    
    for (const post of posts) {
      // Skip if no selftext
      if (!post.selftext) continue;
      
      // Create document from post
      documents.push({
        id: `reddit-post-${post.id}`,
        title: post.title,
        content: this.formatPostContent(post),
        url: `https://reddit.com${post.permalink}`,
        metadata: {
          source: 'reddit',
          timestamp: new Date(post.created_utc * 1000).toISOString(),
          relevanceScore: this.calculateRelevance(post, query),
          author: post.author.name,
          subreddit: post.subreddit.display_name,
          score: post.score,
          comments: post.num_comments,
          awards: post.all_awardings.length
        }
      });
      
      // Get top comments for high-scoring posts
      if (post.score > 100 && depth !== 'quick') {
        await context.updateProgress(`Fetching comments for r/${post.subreddit.display_name}...`, 70);
        
        try {
          const comments = await post.expandReplies({ 
            limit: limit.comments, 
            depth: 1 
          }).comments;
          
          for (const comment of comments.slice(0, limit.comments)) {
            if (comment.body && comment.score > 10) {
              documents.push({
                id: `reddit-comment-${comment.id}`,
                title: `Comment on: ${post.title}`,
                content: comment.body,
                url: `https://reddit.com${comment.permalink}`,
                metadata: {
                  source: 'reddit',
                  timestamp: new Date(comment.created_utc * 1000).toISOString(),
                  relevanceScore: this.calculateRelevance(comment, query) * 0.8,
                  author: comment.author.name,
                  subreddit: post.subreddit.display_name,
                  score: comment.score,
                  parentPost: post.id
                }
              });
            }
          }
        } catch (error) {
          logger.warn({ error, postId: post.id }, 'Failed to fetch comments');
        }
      }
    }
    
    await context.updateProgress('Reddit search complete', 100);
    
    // Sort by relevance
    return documents.sort((a, b) => 
      (b.metadata.relevanceScore || 0) - (a.metadata.relevanceScore || 0)
    );
  }

  /**
   * Format post content with metadata
   */
  private formatPostContent(post: any): string {
    const parts = [
      post.selftext,
      '',
      '---',
      `Subreddit: r/${post.subreddit.display_name}`,
      `Score: ${post.score} | Comments: ${post.num_comments}`,
      `Posted: ${new Date(post.created_utc * 1000).toLocaleDateString()}`
    ];
    
    if (post.link_flair_text) {
      parts.push(`Flair: ${post.link_flair_text}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Calculate relevance score
   */
  private calculateRelevance(item: any, query: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const content = (item.title + ' ' + (item.selftext || item.body || '')).toLowerCase();
    
    // Term frequency
    let matches = 0;
    for (const term of queryTerms) {
      if (content.includes(term)) matches++;
    }
    const termScore = matches / queryTerms.length;
    
    // Engagement score (normalized)
    const engagementScore = Math.min(item.score / 1000, 1) * 0.3;
    
    // Recency score (posts within last year get bonus)
    const ageInDays = (Date.now() - item.created_utc * 1000) / (1000 * 60 * 60 * 24);
    const recencyScore = ageInDays < 365 ? 0.2 : 0;
    
    // Award score
    const awardScore = item.all_awardings ? Math.min(item.all_awardings.length / 5, 0.2) : 0;
    
    return termScore * 0.5 + engagementScore + recencyScore + awardScore;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    this.reddit = undefined;
    logger.info('Reddit plugin disposed');
  }
}

export default RedditSourcePlugin;