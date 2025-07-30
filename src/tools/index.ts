import type { Tool } from '../types.js';
import { researchBriefTool } from './research.js';
import { researchStatusTool } from './status.js';
import { researchExportTool } from './export.js';

// Export all tools as a map
export const tools = new Map<string, Tool>([
  ['research_brief', researchBriefTool],
  ['research_status', researchStatusTool],
  ['research_export', researchExportTool]
]);

// Export individual tools for direct access
export { researchBriefTool, researchStatusTool, researchExportTool };