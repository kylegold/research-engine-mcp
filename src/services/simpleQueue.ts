import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';
import path from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const logger = createLogger('simple-queue');

// Database singleton
let db: Database.Database | null = null;
let initialized = false;

/**
 * Initialize the database connection with proper directory handling
 * This function is idempotent and safe to call multiple times
 */
async function initializeDatabase(): Promise<Database.Database> {
  if (db && initialized) {
    return db;
  }

  try {
    // Determine database path based on environment
    let dbPath: string;
    
    if (process.env.SQLITE_DB_PATH) {
      // Use explicit path if provided
      dbPath = process.env.SQLITE_DB_PATH;
    } else if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
      // In production/Railway, use /tmp which is always writable
      // This is ephemeral but works well for job queues
      dbPath = '/tmp/research-engine-jobs.db';
    } else {
      // In development, use local data directory
      const dataDir = path.join(process.cwd(), 'data');
      if (!existsSync(dataDir)) {
        await mkdir(dataDir, { recursive: true });
      }
      dbPath = path.join(dataDir, 'jobs.db');
    }

    // Ensure the directory exists for the database
    const dbDir = path.dirname(dbPath);
    if (!existsSync(dbDir)) {
      await mkdir(dbDir, { recursive: true });
    }

    // Initialize database connection
    db = new Database(dbPath);
    
    // Configure for better performance and reliability
    db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
    db.pragma('busy_timeout = 5000'); // Wait up to 5 seconds if database is locked
    db.pragma('synchronous = NORMAL'); // Good balance of safety and performance
    db.pragma('cache_size = 10000'); // Larger cache for better performance
    db.pragma('foreign_keys = ON'); // Enable foreign key constraints

    logger.info({ dbPath }, 'Initialized SQLite database');

    // Initialize schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        data TEXT NOT NULL,
        result TEXT,
        progress INTEGER DEFAULT 0,
        current_step TEXT DEFAULT '',
        created_at INTEGER DEFAULT (unixepoch()),
        started_at INTEGER,
        completed_at INTEGER,
        attempts INTEGER DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_created ON jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_status_created ON jobs(status, created_at);
    `);

    // Progress tracking for SSE
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_progress (
        job_id TEXT PRIMARY KEY,
        progress_data TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_progress_updated ON job_progress(updated_at);
    `);

    initialized = true;
    return db;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize database');
    throw error;
  }
}

/**
 * Get database connection, initializing if necessary
 */
async function getDb(): Promise<Database.Database> {
  if (!db || !initialized) {
    return await initializeDatabase();
  }
  return db;
}

export interface JobData {
  brief: string;
  depth?: 'quick' | 'standard' | 'deep';
  sources?: string[];
  userId?: string;
  exportFormat?: 'notion' | 'markdown' | 'json';
  exportCredentials?: Record<string, any>;
}

export interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  data: JobData;
  result?: any;
  progress: number;
  currentStep?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  attempts: number;
  error?: string;
}

export async function createJob(data: JobData): Promise<{ id: string; status: string }> {
  const database = await getDb();
  const id = uuidv4();
  const stmt = database.prepare(
    'INSERT INTO jobs (id, data) VALUES (?, ?)'
  );
  
  stmt.run(id, JSON.stringify(data));
  
  logger.info({ jobId: id }, 'Created new job');
  
  return { id, status: 'pending' };
}

export async function getNextJob(): Promise<Job | null> {
  const database = await getDb();
  const transaction = database.transaction(() => {
    // First, find the next pending job
    const selectStmt = database.prepare(`
      SELECT id FROM jobs 
      WHERE status = 'pending' 
      AND attempts < 3
      ORDER BY created_at 
      LIMIT 1
    `);
    
    const pendingJob = selectStmt.get() as { id: string } | undefined;
    if (!pendingJob) return null;
    
    // Then update it to processing
    const updateStmt = database.prepare(`
      UPDATE jobs 
      SET status = 'processing', 
          started_at = unixepoch(),
          attempts = attempts + 1
      WHERE id = ?
    `);
    
    updateStmt.run(pendingJob.id);
    
    // Finally, get the full job data
    const getStmt = database.prepare('SELECT * FROM jobs WHERE id = ?');
    return getStmt.get(pendingJob.id);
  });
  
  const job = transaction() as any;
  
  if (!job) return null;
  
  return {
    id: job.id,
    status: job.status,
    data: JSON.parse(job.data),
    result: job.result ? JSON.parse(job.result) : undefined,
    progress: job.progress,
    currentStep: job.current_step || undefined,
    createdAt: new Date(job.created_at * 1000),
    startedAt: job.started_at ? new Date(job.started_at * 1000) : undefined,
    completedAt: job.completed_at ? new Date(job.completed_at * 1000) : undefined,
    attempts: job.attempts,
    error: job.error || undefined
  };
}

export async function updateJobProgress(
  id: string, 
  progress: number, 
  currentStep?: string,
  progressData?: any
): Promise<void> {
  const database = await getDb();
  const transaction = database.transaction(() => {
    // Update job progress
    const jobStmt = database.prepare(`
      UPDATE jobs 
      SET progress = ?, 
          current_step = COALESCE(?, current_step)
      WHERE id = ?
    `);
    jobStmt.run(progress, currentStep, id);
    
    // Update progress data for SSE
    if (progressData) {
      const progressStmt = database.prepare(`
        INSERT OR REPLACE INTO job_progress (job_id, progress_data, updated_at)
        VALUES (?, ?, unixepoch())
      `);
      progressStmt.run(id, JSON.stringify(progressData));
    }
  });
  
  transaction();
  
  logger.debug({ jobId: id, progress, currentStep }, 'Updated job progress');
}

export async function completeJob(id: string, result: any): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(`
    UPDATE jobs 
    SET status = 'completed', 
        result = ?, 
        completed_at = unixepoch(),
        progress = 100
    WHERE id = ?
  `);
  
  stmt.run(JSON.stringify(result), id);
  
  logger.info({ jobId: id }, 'Job completed');
}

export async function failJob(id: string, error: string): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(`
    UPDATE jobs 
    SET status = 'failed', 
        error = ?,
        completed_at = unixepoch()
    WHERE id = ?
  `);
  
  stmt.run(error, id);
  
  logger.error({ jobId: id, error }, 'Job failed');
}

export async function getJob(id: string): Promise<Job | null> {
  const database = await getDb();
  const stmt = database.prepare('SELECT * FROM jobs WHERE id = ?');
  const job = stmt.get(id) as any;
  
  if (!job) return null;
  
  return {
    id: job.id,
    status: job.status,
    data: JSON.parse(job.data),
    result: job.result ? JSON.parse(job.result) : undefined,
    progress: job.progress,
    currentStep: job.current_step || undefined,
    createdAt: new Date(job.created_at * 1000),
    startedAt: job.started_at ? new Date(job.started_at * 1000) : undefined,
    completedAt: job.completed_at ? new Date(job.completed_at * 1000) : undefined,
    attempts: job.attempts,
    error: job.error || undefined
  };
}

export async function getJobProgress(id: string): Promise<any | null> {
  const database = await getDb();
  const stmt = database.prepare('SELECT progress_data FROM job_progress WHERE job_id = ?');
  const row = stmt.get(id) as { progress_data: string } | undefined;
  
  return row ? JSON.parse(row.progress_data) : null;
}

// Clean up old jobs (optional, run periodically)
export async function cleanupOldJobs(daysOld = 7): Promise<number> {
  const database = await getDb();
  const cutoff = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
  
  const transaction = database.transaction(() => {
    // Delete old job progress first (due to foreign key constraint)
    const progressStmt = database.prepare(`
      DELETE FROM job_progress 
      WHERE job_id IN (
        SELECT id FROM jobs 
        WHERE completed_at < ? 
        AND status IN ('completed', 'failed')
      )
    `);
    progressStmt.run(cutoff);
    
    // Then delete the jobs
    const jobsStmt = database.prepare(`
      DELETE FROM jobs 
      WHERE completed_at < ? 
      AND status IN ('completed', 'failed')
    `);
    return jobsStmt.run(cutoff);
  });
  
  const result = transaction();
  
  if (result.changes > 0) {
    logger.info({ deleted: result.changes }, 'Cleaned up old jobs');
  }
  
  return result.changes;
}

// Graceful shutdown
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    initialized = false;
    logger.info('Database connection closed');
  }
}

// Handle process termination
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});