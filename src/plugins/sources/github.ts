import { BaseSourcePlugin } from '../base.js';
import { PluginContext, PluginResult, Document } from '../types.js';
import { Octokit } from '@octokit/rest';
import Bottleneck from 'bottleneck';
import pRetry from 'p-retry';

/**
 * GitHub source plugin for searching repositories and issues
 * Production-ready with rate limiting and error handling
 */
export default class GitHubPlugin extends BaseSourcePlugin {
  id = 'github';
  name = 'GitHub';
  description = 'Search GitHub repositories and issues for developer insights';
  version = '1.0.0';
  
  private octokit?: Octokit;
  private limiter: Bottleneck;
  
  constructor() {
    super();
    
    // GitHub API rate limits: 30 requests/minute for search
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 2000, // 2 seconds between requests
      reservoir: 30,
      reservoirRefreshAmount: 30,
      reservoirRefreshInterval: 60 * 1000 // Refill every minute
    });
  }
  
  /**
   * Initialize with GitHub token
   */
  async initialize(config: Record<string, any>): Promise<void> {
    const token = config.githubToken || process.env.GITHUB_TOKEN;
    
    if (token) {
      this.octokit = new Octokit({ auth: token });
      this.logger.info('GitHub plugin initialized with authentication');
    } else {
      this.octokit = new Octokit();
      this.logger.warn('GitHub plugin initialized without authentication (rate limits apply)');
    }
    
    await super.initialize?.(config);
  }
  
  /**
   * Check if this plugin supports the query
   */
  supports(query: string, _context: any): boolean {
    // Support queries that mention GitHub, repos, issues, or code
    const githubKeywords = ['github', 'repository', 'repo', 'issue', 'pull request', 'pr', 'code'];
    const lowerQuery = query.toLowerCase();
    
    return githubKeywords.some(keyword => lowerQuery.includes(keyword));
  }
  
  /**
   * Execute GitHub search
   */
  protected async doSearch(context: PluginContext): Promise<PluginResult> {
    const { query, updateProgress, depth = 'standard' } = context;
    
    if (!this.octokit) {
      throw new Error('GitHub plugin not initialized');
    }
    
    try {
      const documents: Document[] = [];
      
      // Search repositories
      await updateProgress('Searching GitHub repositories...', 20);
      const repos = await this.searchRepositories(query, depth);
      documents.push(...repos);
      
      await updateProgress('Searching GitHub issues...', 50);
      
      // For each top repo, get issues
      const topRepos = repos.slice(0, depth === 'deep' ? 5 : 3);
      for (const repo of topRepos) {
        const repoFullName = repo.metadata.fullName as string;
        const issues = await this.getRepoIssues(repoFullName, query);
        documents.push(...issues);
      }
      
      await updateProgress('GitHub search complete', 100);
      
      return {
        success: true,
        documents,
        metadata: {
          source: this.id,
          documentsFound: documents.length,
          duration: 0 // Will be set by base class
        }
      };
    } catch (error) {
      this.logger.error({ error }, 'GitHub search failed');
      throw error;
    }
  }
  
  /**
   * Search GitHub repositories
   */
  private async searchRepositories(query: string, depth: string): Promise<Document[]> {
    const starRange = this.getStarRange(depth);
    const searchQuery = `${query} stars:${starRange} sort:stars`;
    
    const response = await this.limiter.schedule(() =>
      pRetry(
        () => this.octokit!.search.repos({
          q: searchQuery,
          per_page: depth === 'deep' ? 20 : 10,
          sort: 'stars' as const,
          order: 'desc' as const
        }),
        {
          retries: 3,
          onFailedAttempt: error => {
            this.logger.warn(
              { error: error.message, attempt: error.attemptNumber },
              'Repository search attempt failed'
            );
          }
        }
      )
    );
    
    return response.data.items.map(repo => ({
      id: `${this.id}-repo-${repo.id}`,
      title: repo.full_name,
      content: this.formatRepoContent(repo),
      url: repo.html_url,
      metadata: {
        source: this.id,
        timestamp: new Date().toISOString(),
        relevanceScore: this.calculateRepoRelevance(repo),
        type: 'repository',
        fullName: repo.full_name,
        stars: repo.stargazers_count,
        language: repo.language,
        topics: repo.topics || []
      }
    }));
  }
  
  /**
   * Get issues from a repository
   */
  private async getRepoIssues(repoFullName: string, query: string): Promise<Document[]> {
    const parts = repoFullName.split('/');
    if (parts.length !== 2) return [];
    
    const [owner, repo] = parts;
    if (!owner || !repo) return [];
    
    try {
      const response = await this.limiter.schedule(() =>
        pRetry(
          () => this.octokit!.issues.listForRepo({
            owner,
            repo,
            state: 'all',
            sort: 'comments' as const,
            direction: 'desc',
            per_page: 10
          }),
          { retries: 3 }
        )
      );
      
      // Filter issues related to query
      const relevantIssues = response.data.filter(issue => {
        const searchText = `${issue.title} ${issue.body || ''}`.toLowerCase();
        return query.toLowerCase().split(' ').some(term => searchText.includes(term));
      });
      
      return relevantIssues.slice(0, 5).map(issue => ({
        id: `${this.id}-issue-${issue.id}`,
        title: `${repoFullName}#${issue.number}: ${issue.title}`,
        content: this.formatIssueContent(issue),
        url: issue.html_url,
        metadata: {
          source: this.id,
          timestamp: new Date().toISOString(),
          relevanceScore: this.calculateIssueRelevance(issue),
          type: 'issue',
          repository: repoFullName,
          number: issue.number,
          state: issue.state,
          reactions: issue.reactions?.total_count || 0,
          comments: issue.comments
        }
      }));
    } catch (error) {
      this.logger.warn({ error, repo: repoFullName }, 'Failed to fetch issues');
      return [];
    }
  }
  
  /**
   * Format repository content
   */
  private formatRepoContent(repo: any): string {
    const sections = [
      `# ${repo.full_name}`,
      '',
      repo.description || 'No description available',
      '',
      '## Statistics',
      `- Stars: ${repo.stargazers_count.toLocaleString()}`,
      `- Forks: ${repo.forks_count.toLocaleString()}`,
      `- Open Issues: ${repo.open_issues_count.toLocaleString()}`,
      `- Language: ${repo.language || 'Not specified'}`,
      `- Last Updated: ${new Date(repo.updated_at).toLocaleDateString()}`
    ];
    
    if (repo.topics && repo.topics.length > 0) {
      sections.push('', '## Topics', repo.topics.join(', '));
    }
    
    return sections.join('\n');
  }
  
  /**
   * Format issue content
   */
  private formatIssueContent(issue: any): string {
    const sections = [
      `# ${issue.title}`,
      '',
      `**State:** ${issue.state}`,
      `**Created:** ${new Date(issue.created_at).toLocaleDateString()}`,
      `**Reactions:** ${issue.reactions?.total_count || 0}`,
      `**Comments:** ${issue.comments}`,
      '',
      '## Description',
      issue.body || 'No description provided'
    ];
    
    return sections.join('\n');
  }
  
  /**
   * Get star range based on depth
   */
  private getStarRange(depth: string): string {
    const ranges = {
      quick: '5000..50000',
      standard: '10000..50000',
      deep: '1000..100000'
    };
    
    return ranges[depth as keyof typeof ranges] || ranges.standard;
  }
  
  /**
   * Calculate repository relevance score
   */
  private calculateRepoRelevance(repo: any): number {
    let score = 0;
    
    // Star-based scoring (normalized)
    score += Math.min(repo.stargazers_count / 50000, 1) * 0.4;
    
    // Activity scoring
    const daysSinceUpdate = (Date.now() - new Date(repo.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - daysSinceUpdate / 365) * 0.3;
    
    // Issue activity
    score += Math.min(repo.open_issues_count / 100, 1) * 0.2;
    
    // Has description
    score += repo.description ? 0.1 : 0;
    
    return Math.round(score * 100) / 100;
  }
  
  /**
   * Calculate issue relevance score
   */
  private calculateIssueRelevance(issue: any): number {
    let score = 0;
    
    // Reaction-based scoring
    score += Math.min((issue.reactions?.total_count || 0) / 50, 1) * 0.4;
    
    // Comment activity
    score += Math.min(issue.comments / 20, 1) * 0.3;
    
    // Recency
    const daysSinceCreated = (Date.now() - new Date(issue.created_at).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - daysSinceCreated / 365) * 0.2;
    
    // Open issues score higher
    score += issue.state === 'open' ? 0.1 : 0;
    
    return Math.round(score * 100) / 100;
  }
  
  /**
   * Get cache TTL - GitHub data can be cached for a while
   */
  protected getCacheTTL(): number {
    return 3600; // 1 hour
  }
}