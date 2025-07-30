import { createLogger } from '../utils/logger.js';
import { GitHubSearchPlugin } from './sources/github-simple.js';
import { WebSearchPlugin } from './sources/websearch-simple.js';

const logger = createLogger('orchestrator');

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface ResearchResult {
  success: boolean;
  sources: SearchResult[];
  summary?: string;
  error?: string;
}

// Plugin instances
let githubPlugin: GitHubSearchPlugin;
let webSearchPlugin: WebSearchPlugin;

// Initialize plugins
export async function initializePlugins() {
  githubPlugin = new GitHubSearchPlugin();
  webSearchPlugin = new WebSearchPlugin();
  
  logger.info('Plugins initialized');
}

// Extract keywords from brief (simple implementation)
function extractKeywords(brief: string): string[] {
  // Remove common words and extract meaningful terms
  const stopWords = new Set([
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
    'in', 'with', 'to', 'for', 'of', 'as', 'by', 'that', 'this',
    'it', 'from', 'be', 'are', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might'
  ]);
  
  // Split and filter
  const words = brief.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));
  
  // Get unique words
  const unique = Array.from(new Set(words));
  
  // Return top keywords
  return unique.slice(0, 10);
}

// Run research with all plugins
export async function runResearch(
  brief: string, 
  options: {
    depth?: string;
    sources?: string[];
    exportFormat?: string;
    exportCredentials?: any;
    userId?: string;
  },
  onProgress?: (progress: number) => void
): Promise<ResearchResult> {
  try {
    logger.info({ brief, options }, 'Starting research');
    
    const results: SearchResult[] = [];
    const enabledSources = options.sources || ['github', 'websearch'];
    
    // Extract search keywords from brief
    const keywords = extractKeywords(brief);
    const searchQuery = keywords.join(' ');
    
    logger.info({ keywords, searchQuery }, 'Extracted search terms');
    
    // Run GitHub search if enabled
    if (enabledSources.includes('github') && githubPlugin) {
      try {
        onProgress?.(20);
        logger.info('Running GitHub search');
        
        const githubResults = await githubPlugin.search(searchQuery, {
          depth: options.depth,
          maxResults: options.depth === 'deep' ? 30 : 10
        });
        
        results.push(...githubResults);
        logger.info({ count: githubResults.length }, 'GitHub search completed');
      } catch (error) {
        logger.error({ error }, 'GitHub search failed');
      }
    }
    
    // Run web search if enabled
    if (enabledSources.includes('websearch') && webSearchPlugin) {
      try {
        onProgress?.(50);
        logger.info('Running web search');
        
        const webResults = await webSearchPlugin.search(searchQuery, {
          depth: options.depth,
          maxResults: options.depth === 'deep' ? 20 : 10
        });
        
        results.push(...webResults);
        logger.info({ count: webResults.length }, 'Web search completed');
      } catch (error) {
        logger.error({ error }, 'Web search failed');
      }
    }
    
    onProgress?.(80);
    
    // Simple summarization
    const summary = results.length > 0 
      ? `Found ${results.length} relevant results across ${enabledSources.join(', ')}. The search covered: ${keywords.slice(0, 5).join(', ')}.`
      : 'No results found for the given query.';
    
    onProgress?.(100);
    
    return {
      success: true,
      sources: results,
      summary
    };
  } catch (error) {
    logger.error({ error }, 'Research failed');
    return {
      success: false,
      sources: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}