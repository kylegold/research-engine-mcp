/**
 * Job lifecycle types following Chief Architect's patterns
 */

export enum JobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  PARTIAL_OK = 'partial_ok',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface JobMetadata {
  jobId: string;
  userId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  attempt: number;
  maxAttempts: number;
}

export interface JobProgress {
  status: JobStatus;
  percentComplete: number;
  currentStep: string;
  messages: string[];
  pluginStatuses: Record<string, PluginJobStatus>;
  metadata: JobMetadata;
}

export interface PluginJobStatus {
  pluginId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  progress: number;
  message?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  error?: string;
}

export interface JobResult<T = any> {
  jobId: string;
  status: JobStatus;
  data?: T;
  error?: JobError;
  metadata: JobMetadata;
  pluginResults?: PluginJobStatus[];
}

export interface JobError {
  code: string;
  message: string;
  details?: any;
  retryable: boolean;
  retryIn?: number;
}

export class JobLifecycle {
  private progress: JobProgress;
  
  constructor(jobId: string, userId?: string) {
    this.progress = {
      status: JobStatus.QUEUED,
      percentComplete: 0,
      currentStep: 'Initializing',
      messages: ['Job created'],
      pluginStatuses: {},
      metadata: {
        jobId,
        userId,
        createdAt: new Date().toISOString(),
        attempt: 1,
        maxAttempts: 3
      }
    };
  }
  
  start(): void {
    this.progress.status = JobStatus.RUNNING;
    this.progress.metadata.startedAt = new Date().toISOString();
    this.addMessage('Job started');
  }
  
  updateStep(step: string, percentComplete?: number): void {
    this.progress.currentStep = step;
    if (percentComplete !== undefined) {
      this.progress.percentComplete = Math.min(100, Math.max(0, percentComplete));
    }
    this.addMessage(step);
  }
  
  updatePluginStatus(pluginId: string, status: Partial<PluginJobStatus>): void {
    if (!this.progress.pluginStatuses[pluginId]) {
      this.progress.pluginStatuses[pluginId] = {
        pluginId,
        status: 'pending',
        progress: 0
      };
    }
    
    Object.assign(this.progress.pluginStatuses[pluginId], status);
    
    // Update overall status if needed
    const allStatuses = Object.values(this.progress.pluginStatuses);
    const hasFailures = allStatuses.some(s => s.status === 'failed');
    const hasSuccesses = allStatuses.some(s => s.status === 'completed');
    
    if (hasFailures && hasSuccesses) {
      this.progress.status = JobStatus.PARTIAL_OK;
    }
  }
  
  succeed(data?: any): JobResult {
    this.progress.status = JobStatus.SUCCEEDED;
    this.progress.percentComplete = 100;
    this.progress.metadata.completedAt = new Date().toISOString();
    this.progress.metadata.duration = this.calculateDuration();
    this.addMessage('Job completed successfully');
    
    return {
      jobId: this.progress.metadata.jobId,
      status: JobStatus.SUCCEEDED,
      data,
      metadata: this.progress.metadata,
      pluginResults: Object.values(this.progress.pluginStatuses)
    };
  }
  
  fail(error: JobError): JobResult {
    this.progress.status = JobStatus.FAILED;
    this.progress.metadata.completedAt = new Date().toISOString();
    this.progress.metadata.duration = this.calculateDuration();
    this.addMessage(`Job failed: ${error.message}`);
    
    return {
      jobId: this.progress.metadata.jobId,
      status: JobStatus.FAILED,
      error,
      metadata: this.progress.metadata,
      pluginResults: Object.values(this.progress.pluginStatuses)
    };
  }
  
  cancel(): JobResult {
    this.progress.status = JobStatus.CANCELLED;
    this.progress.metadata.completedAt = new Date().toISOString();
    this.progress.metadata.duration = this.calculateDuration();
    this.addMessage('Job cancelled');
    
    return {
      jobId: this.progress.metadata.jobId,
      status: JobStatus.CANCELLED,
      metadata: this.progress.metadata,
      pluginResults: Object.values(this.progress.pluginStatuses)
    };
  }
  
  getProgress(): JobProgress {
    return { ...this.progress };
  }
  
  private addMessage(message: string): void {
    this.progress.messages.push(`[${new Date().toISOString()}] ${message}`);
    
    // Keep only last 100 messages
    if (this.progress.messages.length > 100) {
      this.progress.messages = this.progress.messages.slice(-100);
    }
  }
  
  private calculateDuration(): number {
    if (!this.progress.metadata.startedAt) return 0;
    
    const start = new Date(this.progress.metadata.startedAt).getTime();
    const end = this.progress.metadata.completedAt 
      ? new Date(this.progress.metadata.completedAt).getTime()
      : Date.now();
    
    return end - start;
  }
}