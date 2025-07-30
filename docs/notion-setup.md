# Notion Integration Setup Guide

This guide explains how users can connect the Research Engine to their own Notion workspace.

## How It Works

When users select "Notion" as their export format, the Research Engine needs access to their Notion workspace. There are two approaches:

## Option 1: User Provides Notion API Key (Recommended)

### For End Users:

1. **Create a Notion Integration**
   - Go to https://www.notion.so/my-integrations
   - Click "New integration"
   - Name it "Research Engine"
   - Select the workspace
   - Copy the API key

2. **Create a Database**
   - Create a new Notion database for research results
   - Click "..." menu → "Add connections" → Select your integration
   - Copy the database ID from the URL:
     ```
     https://notion.so/workspace/DATABASE_ID_HERE?v=...
     ```

3. **Configure in Commands.com**
   - When running `/research`, include your credentials:
   ```
   /research "Your research brief" --notion-key=YOUR_KEY --notion-db=DATABASE_ID
   ```

### Implementation in Your Research API:

```typescript
// Handle user-provided Notion credentials
export async function exportToNotion(insights: any, userConfig: {
  notionKey: string;
  notionDatabaseId: string;
}) {
  const notion = new Client({ 
    auth: userConfig.notionKey  // User's key, not yours
  });
  
  const page = await notion.pages.create({
    parent: { database_id: userConfig.notionDatabaseId },
    // ... rest of the export
  });
}
```

## Option 2: OAuth Integration (Advanced)

### Build a Notion OAuth Flow:

1. **Register Your App with Notion**
   - Go to https://www.notion.so/my-integrations
   - Create a public integration
   - Get OAuth credentials

2. **Implement OAuth in Your Research API**
   ```typescript
   // OAuth endpoints in your Research API
   app.get('/auth/notion', (req, res) => {
     const authUrl = `https://api.notion.com/v1/oauth/authorize?` +
       `client_id=${NOTION_CLIENT_ID}&` +
       `response_type=code&` +
       `redirect_uri=${REDIRECT_URI}`;
     res.redirect(authUrl);
   });
   
   app.get('/auth/notion/callback', async (req, res) => {
     const { code } = req.query;
     // Exchange code for access token
     // Store token associated with user
   });
   ```

3. **Store User Tokens**
   ```sql
   CREATE TABLE user_integrations (
     user_id TEXT,
     notion_access_token TEXT,
     notion_workspace_id TEXT,
     created_at TIMESTAMP
   );
   ```

## Option 3: Command Parameter Approach (Simplest)

Update your command to accept Notion credentials as parameters:

```yaml
# In commands.yaml
inputParameters:
  - name: notionKey
    label: Notion API Key (optional)
    description: Your Notion integration API key
    type: password
    required: false
  - name: notionDatabaseId
    label: Notion Database ID (optional)
    description: The database to export to
    type: text
    required: false
```

Then in your MCP server:

```typescript
// In research_brief tool
handler: async (args, context) => {
  const response = await researchApi.createJob({
    brief: args.brief,
    exportConfig: {
      format: args.export,
      notionKey: args.notionKey,
      notionDatabaseId: args.notionDatabaseId
    }
  });
}
```

## Best Practices

### 1. Secure Credential Handling
- Never log API keys
- Encrypt stored tokens
- Use environment variables for defaults
- Clear tokens on errors

### 2. Database Template
Provide a Notion template users can duplicate:

```typescript
// Recommended database properties
{
  "Title": { type: "title" },
  "Brief": { type: "rich_text" },
  "Status": { type: "select", options: ["New", "Reviewed", "Actioned"] },
  "Pain Points": { type: "rich_text" },
  "Opportunities": { type: "rich_text" },
  "Priority": { type: "select", options: ["High", "Medium", "Low"] },
  "Created": { type: "date" },
  "Sources": { type: "url" }
}
```

### 3. Error Handling
```typescript
try {
  await exportToNotion(data, userConfig);
} catch (error) {
  if (error.code === 'unauthorized') {
    return {
      error: 'Notion API key is invalid or expired. Please check your credentials.'
    };
  }
  if (error.code === 'object_not_found') {
    return {
      error: 'Notion database not found. Make sure you connected your integration.'
    };
  }
}
```

## User Documentation

Add this to your command help:

```markdown
## Exporting to Notion

To export research results to your Notion workspace:

1. Create a Notion integration at https://www.notion.so/my-integrations
2. Create a database and connect your integration
3. Run the command with your credentials:
   ```
   /research "Your research" --export=notion --notion-key=YOUR_KEY --notion-db=DB_ID
   ```

Or save your credentials in your Research Engine account settings for easier use.
```

## Security Considerations

1. **API Key Storage**: If storing keys, use encryption
2. **Workspace Isolation**: Each user only accesses their workspace
3. **Rate Limits**: Implement per-user rate limiting
4. **Token Rotation**: Support token refresh for OAuth
5. **Audit Trail**: Log exports for security

This approach ensures each user maintains control of their own Notion workspace while using your service.