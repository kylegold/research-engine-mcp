import { Octokit } from '@octokit/rest';
import { createLogger } from '../../utils/logger.js';
import type { SearchResult } from '../simple-orchestrator.js';

const logger = createLogger('github-plugin');

export class GitHubSearchPlugin {
  private octokit: Octokit;
  
  constructor() {
    const token = process.env.GITHUB_TOKEN;
    
    if (token) {
      this.octokit = new Octokit({ auth: token });
      logger.info('GitHub plugin initialized with authentication');
    } else {
      this.octokit = new Octokit();
      logger.warn('GitHub plugin initialized without authentication (rate limits will apply)');
    }
  }
  
  async search(query: string, options: { depth?: string; maxResults?: number } = {}): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const maxResults = options.maxResults || 10;
    
    try {
      // Search repositories
      const repoResults = await this.searchRepositories(query, Math.floor(maxResults / 2));
      results.push(...repoResults);
      
      // Search issues if we have room
      if (results.length < maxResults) {
        const issueResults = await this.searchIssues(query, maxResults - results.length);
        results.push(...issueResults);
      }
      
      return results;
    } catch (error: any) {
      if (error.status === 403 && error.message.includes('rate limit')) {
        logger.error('GitHub API rate limit exceeded');
        throw new Error('GitHub API rate limit exceeded. Please add GITHUB_TOKEN to environment variables.');
      }
      throw error;
    }
  }
  
  private async searchRepositories(query: string, limit: number): Promise<SearchResult[]> {
    try {
      // Limit query length to avoid API errors
      const searchQuery = query.length > 128 ? query.substring(0, 128) : query;
      
      const response = await this.octokit.search.repos({
        q: `${searchQuery} stars:>100`,
        sort: 'stars',
        order: 'desc',
        per_page: limit
      });
      
      return response.data.items.map(repo => ({
        id: `github-repo-${repo.id}`,
        title: repo.full_name,
        url: repo.html_url,
        content: repo.description || 'No description available',
        metadata: {
          type: 'repository',
          stars: repo.stargazers_count,
          language: repo.language,
          topics: repo.topics || []
        }
      }));
    } catch (error: any) {
      logger.error({ error: error.message }, 'Repository search failed');
      return [];
    }
  }
  
  private async searchIssues(query: string, limit: number): Promise<SearchResult[]> {
    try {
      // Limit query length
      const searchQuery = query.length > 128 ? query.substring(0, 128) : query;
      
      const response = await this.octokit.search.issuesAndPullRequests({
        q: `${searchQuery} is:issue is:open comments:>5`,
        sort: 'interactions',
        order: 'desc',
        per_page: limit
      });
      
      return response.data.items.map(issue => ({
        id: `github-issue-${issue.id}`,
        title: issue.title,
        url: issue.html_url,
        content: issue.body ? issue.body.substring(0, 500) + '...' : 'No description available',
        metadata: {
          type: 'issue',
          state: issue.state,
          comments: issue.comments,
          repository: issue.repository_url.split('/').slice(-2).join('/')
        }
      }));
    } catch (error: any) {
      logger.error({ error: error.message }, 'Issue search failed');
      return [];
    }
  }
}