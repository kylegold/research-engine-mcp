import { Octokit } from '@octokit/rest';
import { githubLimiter } from '../utils/rateLimiter.js';
import { withCache } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'research-engine/1.0',
  throttle: {
    onRateLimit: (_retryAfter: any, _options: any) => {
      logger.warn(
        'Request quota exhausted for GitHub API request'
      );
      return true; // Retry
    },
    onSecondaryRateLimit: (_retryAfter: any, _options: any) => {
      logger.error(
        'Secondary rate limit detected for GitHub API request'
      );
      return false; // Don't retry
    }
  }
});

interface GitHubSearchResult {
  source: 'github';
  type: 'repository' | 'issue' | 'discussion';
  title: string;
  content: string;
  url: string;
  metadata: {
    stars?: number;
    language?: string;
    openIssues?: number;
    labels?: string[];
    reactions?: number;
  };
}

export async function scrapeGitHub(query: string): Promise<GitHubSearchResult[]> {
  logger.info({ query }, 'Starting GitHub scrape');
  
  try {
    // Search repositories with the query
    const repos = await searchRepositories(query);
    
    // Collect pain points from issues
    const painPoints: GitHubSearchResult[] = [];
    
    for (const repo of repos) {
      // Get issues from each repository
      const issues = await getRepositoryIssues(repo);
      painPoints.push(...issues);
      
      // Also get discussions if available
      if (repo.has_discussions) {
        const discussions = await getRepositoryDiscussions(repo);
        painPoints.push(...discussions);
      }
    }
    
    logger.info({ query, count: painPoints.length }, 'GitHub scrape completed');
    return painPoints;
  } catch (error) {
    logger.error({ error, query }, 'GitHub scrape failed');
    throw error;
  }
}

async function searchRepositories(query: string) {
  return withCache('github:repos', query, async () => {
    return withRetry(async () => {
      const response = await githubLimiter.schedule(() =>
        octokit.search.repos({
          q: `${query} stars:10000..50000`,
          sort: 'stars',
          order: 'desc',
          per_page: 20
        })
      );
      
      return response.data.items;
    });
  }, 3600); // Cache for 1 hour
}

async function getRepositoryIssues(repo: any): Promise<GitHubSearchResult[]> {
  return withCache('github:issues', { repo: repo.full_name }, async () => {
    return withRetry(async () => {
      const response = await githubLimiter.schedule(() =>
        octokit.issues.listForRepo({
          owner: repo.owner.login,
          repo: repo.name,
          state: 'open',
          sort: 'comments',
          direction: 'desc',
          per_page: 30,
          labels: 'bug,enhancement,help wanted,question'
        })
      );
      
      return response.data
        .filter(issue => !issue.pull_request) // Exclude PRs
        .map(issue => ({
          source: 'github' as const,
          type: 'issue' as const,
          title: issue.title,
          content: issue.body || '',
          url: issue.html_url,
          metadata: {
            language: repo.language,
            labels: issue.labels.map(l => 
              typeof l === 'string' ? l : l.name || ''
            ),
            reactions: issue.reactions?.total_count || 0
          }
        }));
    });
  }, 3600);
}

async function getRepositoryDiscussions(_repo: any): Promise<GitHubSearchResult[]> {
  // GitHub GraphQL would be better for discussions, but REST API doesn't support it well
  // For now, return empty array - implement GraphQL if needed
  return [];
  
  /* GraphQL implementation example:
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        discussions(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            title
            body
            url
            upvoteCount
            category { name }
          }
        }
      }
    }
  `;
  */
}