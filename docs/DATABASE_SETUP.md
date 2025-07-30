# SQLite Database Setup for Research Engine MCP

This document explains how the SQLite database is configured for different deployment environments.

## Overview

The Research Engine MCP uses SQLite with better-sqlite3 for job queue management. The database initialization has been designed to work seamlessly across different environments without requiring manual setup.

## Database Location Strategy

The database location is determined automatically based on the environment:

1. **Explicit Path (Highest Priority)**
   - If `SQLITE_DB_PATH` environment variable is set, it will be used
   - Example: `SQLITE_DB_PATH=/var/lib/myapp/jobs.db`

2. **Production/Railway (Default for containers)**
   - Detected by `RAILWAY_ENVIRONMENT` or `NODE_ENV=production`
   - Uses `/tmp/research-engine-jobs.db`
   - This is ephemeral but perfect for job queues
   - Always writable in container environments

3. **Development (Local)**
   - Uses `./data/jobs.db` relative to working directory
   - Directory is created automatically if it doesn't exist

## Key Features

### Lazy Initialization
- Database connection is initialized on first use
- No top-level await statements that break ES modules
- Handles directory creation automatically
- Singleton pattern ensures single connection

### Production-Ready Configuration
```javascript
db.pragma('journal_mode = WAL');    // Better concurrency
db.pragma('busy_timeout = 5000');   // Handle locks gracefully
db.pragma('synchronous = NORMAL');  // Balance safety/performance
db.pragma('cache_size = 10000');    // Larger cache
db.pragma('foreign_keys = ON');     // Data integrity
```

### Error Handling
- Proper error logging
- Graceful shutdown on SIGINT/SIGTERM
- Automatic cleanup of database connections

## Deployment Options

### Option 1: Ephemeral Storage (Recommended for Job Queues)
This is the default behavior in production. The database is stored in `/tmp` which:
- Is always writable
- Doesn't require volume configuration
- Perfect for transient job data
- Automatically cleaned on container restart

No additional configuration needed!

### Option 2: Persistent Volume (If Required)
If you need persistent storage across container restarts:

1. Set the environment variable:
   ```bash
   SQLITE_DB_PATH=/app/data/jobs.db
   ```

2. Mount a volume in Railway:
   ```yaml
   volumes:
     - /app/data
   ```

3. Uncomment the volume setup in Dockerfile:
   ```dockerfile
   RUN mkdir -p /app/data && \
       chown -R nodejs:nodejs /app/data
   ```

### Option 3: External Database Path
For advanced deployments, you can specify any writable path:
```bash
SQLITE_DB_PATH=/custom/path/to/database.db
```

## Railway Deployment

For Railway deployments, the default configuration works out of the box:

1. The database uses `/tmp` (ephemeral)
2. No volume configuration required
3. Automatic directory creation
4. Proper permissions for non-root user

If you need persistence, use Railway's volume feature and set `SQLITE_DB_PATH` to the mounted path.

## Docker Deployment

The Dockerfile is configured to:
- Run as non-root user (nodejs:1001)
- Ensure `/tmp` is writable
- Support volume mounts if needed
- Handle signals properly with tini

## Testing the Setup

You can verify the database setup by checking the logs:
```
Initialized SQLite database {"dbPath":"/tmp/research-engine-jobs.db"}
```

## Troubleshooting

### "Cannot open database because the directory does not exist"
This error is now prevented by:
- Checking directory existence before database creation
- Creating directories with recursive flag
- Using `/tmp` in production (always exists)

### "Database is locked"
The configuration includes:
- 5-second busy timeout
- WAL mode for better concurrency
- Proper transaction handling

### Permission Issues
- The container runs as non-root user
- `/tmp` has proper permissions (1777)
- Custom volumes need proper ownership

## Best Practices

1. **Use ephemeral storage for job queues** - Jobs are transient by nature
2. **Set RAILWAY_ENVIRONMENT** in Railway deployments
3. **Monitor disk usage** if using persistent storage
4. **Run cleanup periodically** using the built-in `cleanupOldJobs()` function
5. **Don't share SQLite files** across multiple containers (use PostgreSQL for that)