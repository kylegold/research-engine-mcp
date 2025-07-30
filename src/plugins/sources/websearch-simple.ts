import fetch from 'node-fetch';
import { createLogger } from '../../utils/logger.js';
import type { SearchResult } from '../simple-orchestrator.js';

const logger = createLogger('websearch-plugin');

export class WebSearchPlugin {
  private apiKey?: string;
  private searchProvider: 'serp' | 'bing' | 'none';
  
  constructor() {
    // Check for API keys in order of preference
    if (process.env.SERP_API_KEY) {
      this.apiKey = process.env.SERP_API_KEY;
      this.searchProvider = 'serp';
      logger.info('Web search initialized with SerpAPI');
    } else if (process.env.BING_API_KEY) {
      this.apiKey = process.env.BING_API_KEY;
      this.searchProvider = 'bing';
      logger.info('Web search initialized with Bing API');
    } else {
      this.searchProvider = 'none';
      logger.warn('No web search API key found. Set SERP_API_KEY or BING_API_KEY in environment variables.');
    }
  }
  
  async search(query: string, options: { depth?: string; maxResults?: number } = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults || 10;
    
    switch (this.searchProvider) {
      case 'serp':
        return this.searchWithSerpAPI(query, maxResults);
      case 'bing':
        return this.searchWithBing(query, maxResults);
      default:
        logger.warn('No API key configured, returning empty results');
        return [];
    }
  }
  
  private async searchWithSerpAPI(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        api_key: this.apiKey!,
        num: limit.toString(),
        engine: 'google'
      });
      
      const response = await fetch(`https://serpapi.com/search?${params}`);
      
      if (!response.ok) {
        throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      
      if (data.error) {
        throw new Error(`SerpAPI error: ${data.error}`);
      }
      
      const results: SearchResult[] = [];
      
      // Process organic results
      if (data.organic_results) {
        for (const result of data.organic_results.slice(0, limit)) {
          results.push({
            id: `serp-${results.length}`,
            title: result.title || 'Untitled',
            url: result.link || '',
            content: result.snippet || 'No description available',
            metadata: {
              source: 'serpapi',
              position: result.position
            }
          });
        }
      }
      
      logger.info({ count: results.length }, 'SerpAPI search completed');
      return results;
    } catch (error) {
      logger.error({ error }, 'SerpAPI search failed');
      return [];
    }
  }
  
  private async searchWithBing(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        count: limit.toString(),
        offset: '0',
        mkt: 'en-US',
        safesearch: 'Moderate'
      });
      
      const response = await fetch(
        `https://api.bing.microsoft.com/v7.0/search?${params}`,
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.apiKey!
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Bing API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      const results: SearchResult[] = [];
      
      // Process web pages
      if (data.webPages && data.webPages.value) {
        for (const page of data.webPages.value.slice(0, limit)) {
          results.push({
            id: `bing-${results.length}`,
            title: page.name || 'Untitled',
            url: page.url || '',
            content: page.snippet || 'No description available',
            metadata: {
              source: 'bing',
              dateLastCrawled: page.dateLastCrawled
            }
          });
        }
      }
      
      logger.info({ count: results.length }, 'Bing search completed');
      return results;
    } catch (error) {
      logger.error({ error }, 'Bing search failed');
      return [];
    }
  }
}