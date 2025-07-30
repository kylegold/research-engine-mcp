import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateMcpYaml(): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  
  try {
    const mcpContent = readFileSync(join(process.cwd(), 'mcp.yaml'), 'utf8');
    const mcp = yaml.load(mcpContent) as any;
    
    // Check required fields
    if (!mcp.metadata?.name) result.errors.push('mcp.yaml: metadata.name is required');
    if (!mcp.server?.serverId) result.errors.push('mcp.yaml: server.serverId is required');
    if (!mcp.server?.deployment?.upstreamUrl) {
      result.warnings.push('mcp.yaml: server.deployment.upstreamUrl should be set before deployment');
    }
    
    // Validate tools
    if (mcp.server?.provides?.tools) {
      const tools = mcp.server.provides.tools;
      if (!Array.isArray(tools)) {
        result.errors.push('mcp.yaml: server.provides.tools must be an array');
      } else {
        tools.forEach((tool: any, index: number) => {
          if (!tool.name) result.errors.push(`mcp.yaml: tool[${index}] missing name`);
          if (!tool.description) result.errors.push(`mcp.yaml: tool[${index}] missing description`);
        });
      }
    }
  } catch (error) {
    result.errors.push(`Failed to parse mcp.yaml: ${error}`);
  }
  
  result.valid = result.errors.length === 0;
  return result;
}

function validateCommandsYaml(): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  
  try {
    const commandsContent = readFileSync(join(process.cwd(), 'commands.yaml'), 'utf8');
    const commands = yaml.load(commandsContent) as any;
    
    // Check required fields
    if (!commands.name) result.errors.push('commands.yaml: name is required');
    if (!commands.commands || !Array.isArray(commands.commands)) {
      result.errors.push('commands.yaml: commands array is required');
    } else {
      commands.commands.forEach((cmd: any, index: number) => {
        if (!cmd.name) result.errors.push(`commands.yaml: command[${index}] missing name`);
        if (!cmd.commandName) result.errors.push(`commands.yaml: command[${index}] missing commandName`);
        if (!cmd.mcpRequirements) {
          result.warnings.push(`commands.yaml: command[${index}] missing mcpRequirements`);
        }
      });
    }
  } catch (error) {
    result.errors.push(`Failed to parse commands.yaml: ${error}`);
  }
  
  result.valid = result.errors.length === 0;
  return result;
}

function validateEnvironment(): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  
  // Check for .env file
  try {
    readFileSync(join(process.cwd(), '.env'), 'utf8');
  } catch {
    result.warnings.push('No .env file found. Make sure to set environment variables for deployment.');
  }
  
  // Check critical env vars
  if (!process.env.RESEARCH_API_URL && !process.env.SKIP_AUTH) {
    result.warnings.push('RESEARCH_API_URL not set. Server will use default localhost URL.');
  }
  
  return result;
}

// Run validation
console.log('🔍 Validating Research Engine MCP configuration...\n');

const mcpResult = validateMcpYaml();
const commandsResult = validateCommandsYaml();
const envResult = validateEnvironment();

// Display results
const displayResult = (name: string, result: ValidationResult) => {
  console.log(`${name}:`);
  if (result.valid && result.warnings.length === 0) {
    console.log('  ✅ Valid\n');
  } else {
    if (result.errors.length > 0) {
      console.log('  ❌ Errors:');
      result.errors.forEach(err => console.log(`    - ${err}`));
    }
    if (result.warnings.length > 0) {
      console.log('  ⚠️  Warnings:');
      result.warnings.forEach(warn => console.log(`    - ${warn}`));
    }
    console.log('');
  }
};

displayResult('mcp.yaml', mcpResult);
displayResult('commands.yaml', commandsResult);
displayResult('Environment', envResult);

// Exit with error if validation failed
const allValid = mcpResult.valid && commandsResult.valid;
if (!allValid) {
  console.log('❌ Validation failed. Please fix the errors above.');
  process.exit(1);
} else if (mcpResult.warnings.length > 0 || commandsResult.warnings.length > 0 || envResult.warnings.length > 0) {
  console.log('⚠️  Validation passed with warnings.');
} else {
  console.log('✅ All validations passed!');
}