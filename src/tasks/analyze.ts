import OpenAI from 'openai';
import { openAILimiter } from '../utils/rateLimiter.js';
import { withRetry, isRateLimitError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3
});

interface AnalysisResult {
  title: string;
  summary: string;
  painPoints: Array<{
    category: string;
    description: string;
    frequency: 'high' | 'medium' | 'low';
    sources: string[];
    severity: number;
  }>;
  opportunities: Array<{
    title: string;
    description: string;
    effort: string;
    impact: 'high' | 'medium' | 'low';
    feasibility: number;
  }>;
  insights: string[];
  recommendations: string[];
  metadata: {
    totalSources: number;
    confidenceScore: number;
    analysisDepth: string;
  };
}

const ANALYSIS_PROMPTS = {
  quick: {
    model: 'gpt-3.5-turbo-1106',
    maxTokens: 2000,
    temperature: 0.7
  },
  standard: {
    model: 'gpt-4-1106-preview',
    maxTokens: 4000,
    temperature: 0.7
  },
  deep: {
    model: 'gpt-4-1106-preview',
    maxTokens: 8000,
    temperature: 0.8
  }
};

export async function analyzeWithAI(
  sourceData: any[],
  brief: string,
  depth: string = 'standard'
): Promise<AnalysisResult> {
  logger.info({ brief, depth, sources: sourceData.length }, 'Starting AI analysis');
  
  try {
    // Chunk data if too large
    const chunks = chunkSourceData(sourceData, depth);
    const chunkAnalyses = [];
    
    for (let i = 0; i < chunks.length; i++) {
      logger.info({ chunk: i + 1, total: chunks.length }, 'Analyzing chunk');
      const analysis = await analyzeChunk(chunks[i], brief, depth);
      chunkAnalyses.push(analysis);
    }
    
    // Merge analyses if multiple chunks
    const finalAnalysis = chunks.length > 1 
      ? await mergeAnalyses(chunkAnalyses, brief, depth)
      : chunkAnalyses[0];
    
    logger.info({ brief }, 'AI analysis completed');
    return finalAnalysis;
  } catch (error) {
    logger.error({ error, brief }, 'AI analysis failed');
    throw error;
  }
}

async function analyzeChunk(
  data: any[],
  brief: string,
  depth: string
): Promise<AnalysisResult> {
  const config = ANALYSIS_PROMPTS[depth as keyof typeof ANALYSIS_PROMPTS] || ANALYSIS_PROMPTS.standard;
  
  const systemPrompt = `You are an expert research analyst. Your task is to analyze data and extract actionable insights.
  
  Research Brief: ${brief}
  Analysis Depth: ${depth}
  
  Provide a comprehensive analysis in the following JSON structure:
  {
    "title": "Concise title summarizing the research",
    "summary": "Executive summary of key findings (2-3 paragraphs)",
    "painPoints": [
      {
        "category": "Category name (e.g., Performance, Developer Experience, Documentation)",
        "description": "Clear description of the pain point",
        "frequency": "high|medium|low based on how often it appears",
        "sources": ["github", "reddit"],
        "severity": 1-10
      }
    ],
    "opportunities": [
      {
        "title": "Opportunity title",
        "description": "What could be built to address pain points",
        "effort": "Estimated development time (e.g., '10-20 hours', '1-2 weeks')",
        "impact": "high|medium|low",
        "feasibility": 1-10
      }
    ],
    "insights": ["Key insight or pattern discovered"],
    "recommendations": ["Specific actionable recommendation"],
    "metadata": {
      "totalSources": ${data.length},
      "confidenceScore": 0.0-1.0,
      "analysisDepth": "${depth}"
    }
  }`;
  
  const userPrompt = `Analyze the following data and provide insights:
  
  ${JSON.stringify(data.slice(0, 50))} // Limit to prevent token overflow
  
  Focus on:
  1. Identifying recurring pain points and their severity
  2. Finding opportunities that could be addressed with 6-12 hours of development
  3. Extracting actionable insights and patterns
  4. Providing specific recommendations`;
  
  return withRetry(async () => {
    try {
      const response = await openAILimiter.schedule(() =>
        openai.chat.completions.create({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          response_format: { type: 'json_object' }
        })
      );
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      return JSON.parse(content) as AnalysisResult;
    } catch (error: any) {
      if (isRateLimitError(error)) {
        logger.warn('OpenAI rate limit hit, retrying...');
        throw error; // Let retry handle it
      }
      throw error;
    }
  }, {
    retries: 3,
    minTimeout: 2000,
    factor: 2
  });
}

function chunkSourceData(data: any[], depth: string): any[][] {
  // Estimate tokens per item (rough approximation)
  const tokensPerItem = 200;
  const maxTokensPerChunk = depth === 'deep' ? 6000 : 3000;
  const itemsPerChunk = Math.floor(maxTokensPerChunk / tokensPerItem);
  
  const chunks: any[][] = [];
  for (let i = 0; i < data.length; i += itemsPerChunk) {
    chunks.push(data.slice(i, i + itemsPerChunk));
  }
  
  return chunks;
}

async function mergeAnalyses(
  analyses: AnalysisResult[],
  brief: string,
  depth: string
): Promise<AnalysisResult> {
  // For now, just merge the arrays and take the first summary
  // In production, you'd want a more sophisticated merge
  
  const merged: AnalysisResult = {
    title: analyses[0].title,
    summary: analyses[0].summary,
    painPoints: [],
    opportunities: [],
    insights: [],
    recommendations: [],
    metadata: {
      totalSources: 0,
      confidenceScore: 0,
      analysisDepth: depth
    }
  };
  
  // Merge all arrays
  for (const analysis of analyses) {
    merged.painPoints.push(...analysis.painPoints);
    merged.opportunities.push(...analysis.opportunities);
    merged.insights.push(...analysis.insights);
    merged.recommendations.push(...analysis.recommendations);
    merged.metadata.totalSources += analysis.metadata.totalSources;
  }
  
  // Deduplicate and sort
  merged.painPoints = deduplicatePainPoints(merged.painPoints);
  merged.opportunities = deduplicateOpportunities(merged.opportunities);
  merged.insights = [...new Set(merged.insights)];
  merged.recommendations = [...new Set(merged.recommendations)];
  
  // Average confidence
  merged.metadata.confidenceScore = 
    analyses.reduce((sum, a) => sum + a.metadata.confidenceScore, 0) / analyses.length;
  
  return merged;
}

function deduplicatePainPoints(painPoints: AnalysisResult['painPoints']): AnalysisResult['painPoints'] {
  const seen = new Map<string, typeof painPoints[0]>();
  
  for (const point of painPoints) {
    const key = `${point.category}:${point.description}`;
    if (!seen.has(key)) {
      seen.set(key, point);
    } else {
      // Merge sources
      const existing = seen.get(key)!;
      existing.sources = [...new Set([...existing.sources, ...point.sources])];
      // Take higher severity
      existing.severity = Math.max(existing.severity, point.severity);
    }
  }
  
  return Array.from(seen.values())
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 20); // Top 20 pain points
}

function deduplicateOpportunities(opportunities: AnalysisResult['opportunities']): AnalysisResult['opportunities'] {
  const seen = new Map<string, typeof opportunities[0]>();
  
  for (const opp of opportunities) {
    const key = opp.title;
    if (!seen.has(key)) {
      seen.set(key, opp);
    }
  }
  
  return Array.from(seen.values())
    .sort((a, b) => b.feasibility - a.feasibility)
    .slice(0, 10); // Top 10 opportunities
}