import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';
import path from 'path';
import { mkdir } from 'fs/promises';
// import { fileURLToPath } from 'url';
// import { dirname } from 'path';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

const logger = createLogger('simple-queue');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
await mkdir(dataDir, { recursive: true }).catch(() => {});

// Initialize database
const dbPath = process.env.SQLITE_DB_PATH || path.join(dataDir, 'jobs.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // Enable concurrent reads

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
`);

// Progress tracking for SSE
db.exec(`
  CREATE TABLE IF NOT EXISTS job_progress (
    job_id TEXT PRIMARY KEY,
    progress_data TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );
`);

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
  const id = uuidv4();
  const stmt = db.prepare(
    'INSERT INTO jobs (id, data) VALUES (?, ?)'
  );
  
  stmt.run(id, JSON.stringify(data));
  
  logger.info({ jobId: id }, 'Created new job');
  
  return { id, status: 'pending' };
}

export async function getNextJob(): Promise<Job | null> {
  const transaction = db.transaction(() => {
    // First, find the next pending job
    const selectStmt = db.prepare(`
      SELECT id FROM jobs 
      WHERE status = 'pending' 
      AND attempts < 3
      ORDER BY created_at 
      LIMIT 1
    `);
    
    const pendingJob = selectStmt.get() as { id: string } | undefined;
    if (!pendingJob) return null;
    
    // Then update it to processing
    const updateStmt = db.prepare(`
      UPDATE jobs 
      SET status = 'processing', 
          started_at = unixepoch(),
          attempts = attempts + 1
      WHERE id = ?
    `);
    
    updateStmt.run(pendingJob.id);
    
    // Finally, get the full job data
    const getStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
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
  const transaction = db.transaction(() => {
    // Update job progress
    const jobStmt = db.prepare(`
      UPDATE jobs 
      SET progress = ?, 
          current_step = COALESCE(?, current_step)
      WHERE id = ?
    `);
    jobStmt.run(progress, currentStep, id);
    
    // Update progress data for SSE
    if (progressData) {
      const progressStmt = db.prepare(`
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
  const stmt = db.prepare(`
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
  const stmt = db.prepare(`
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
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
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
  const stmt = db.prepare('SELECT progress_data FROM job_progress WHERE job_id = ?');
  const row = stmt.get(id) as { progress_data: string } | undefined;
  
  return row ? JSON.parse(row.progress_data) : null;
}

// Clean up old jobs (optional, run periodically)
export async function cleanupOldJobs(daysOld = 7): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
  
  const stmt = db.prepare(`
    DELETE FROM jobs 
    WHERE completed_at < ? 
    AND status IN ('completed', 'failed')
  `);
  
  const result = stmt.run(cutoff);
  
  if (result.changes > 0) {
    logger.info({ deleted: result.changes }, 'Cleaned up old jobs');
  }
  
  return result.changes;
}

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
  logger.info('Database connection closed');
}