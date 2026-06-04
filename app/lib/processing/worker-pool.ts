/**
 * Worker pool for CPU-intensive processing tasks
 * Maintains a pool of persistent worker threads to avoid startup overhead.
 * Tasks are dispatched to idle workers or queued until one becomes available.
 *
 * Every dispatched task has a hard timeout: a worker that wedges on a pathological
 * book (infinite loop / never-returning conversion) is terminated and replaced, and
 * its task is rejected — so ONE bad book fails cleanly instead of stalling the whole
 * backfill queue behind a hung await. Worker crash/exit also rejects the in-flight task.
 */
import { Worker } from "worker_threads";
import { cpus } from "os";
import { join } from "path";
import { existsSync } from "fs";
import type { WorkerTask, WorkerResult, WorkerTaskType } from "./processing-worker";
import type { BookFormat } from "../types";

// A single conversion that runs longer than this is treated as wedged. Generous
// enough for the largest real books (thousands of chapters) on a shared host.
const TASK_TIMEOUT_MS = 120_000;

interface PendingTask {
  task: WorkerTask;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
  currentTaskId?: string;
  timer?: ReturnType<typeof setTimeout>;
}

let taskIdCounter = 0;

function getWorkerPath(): string | null {
  const distWorkerPath = join(process.cwd(), "dist/worker/processing-worker.mjs");
  if (existsSync(distWorkerPath)) {
    return distWorkerPath;
  }
  return null;
}

class WorkerPool {
  private workers: WorkerState[] = [];
  private pendingTasks: Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }> =
    new Map();
  private taskQueue: PendingTask[] = [];
  private poolSize: number;
  private workerPath: string;

  constructor(poolSize?: number) {
    const path = getWorkerPath();
    if (!path) {
      throw new Error("Processing worker not built. Run 'pnpm run build:worker' first.");
    }
    this.workerPath = path;
    this.poolSize = poolSize ?? Math.max(2, Math.min(4, cpus().length - 1));
    this.initWorkers();
  }

  private initWorkers(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.addWorker();
    }
    console.log(`[WorkerPool] Initialized with ${this.poolSize} workers`);
  }

  private addWorker(): void {
    const worker = new Worker(this.workerPath);
    const state: WorkerState = { worker, busy: false };

    worker.on("message", (result: WorkerResult) => {
      this.clearTimer(state);
      state.currentTaskId = undefined;
      const pending = this.pendingTasks.get(result.id);
      if (pending) {
        this.pendingTasks.delete(result.id);
        if (result.success) {
          pending.resolve(result.result);
        } else {
          pending.reject(new Error(result.error || "Worker task failed"));
        }
      }
      state.busy = false;
      this.processQueue();
    });

    worker.on("error", (error) => {
      console.error("[WorkerPool] Worker error:", error);
      this.failCurrentTask(state, error);
      this.replaceWorker(state);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[WorkerPool] Worker exited with code ${code}`);
        this.failCurrentTask(state, new Error(`Worker exited with code ${code}`));
        this.replaceWorker(state);
      }
    });

    this.workers.push(state);
  }

  private clearTimer(state: WorkerState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
  }

  /** Reject the task currently in flight on this worker (crash / exit / timeout). */
  private failCurrentTask(state: WorkerState, error: Error): void {
    this.clearTimer(state);
    if (state.currentTaskId) {
      const pending = this.pendingTasks.get(state.currentTaskId);
      if (pending) {
        this.pendingTasks.delete(state.currentTaskId);
        pending.reject(error);
      }
      state.currentTaskId = undefined;
    }
  }

  /** Remove a dead/wedged worker from the pool, terminate it, and spin up a replacement. */
  private replaceWorker(state: WorkerState): void {
    this.clearTimer(state);
    const idx = this.workers.indexOf(state);
    if (idx === -1) return; // already replaced
    this.workers.splice(idx, 1);
    state.worker.terminate().catch(() => {});
    this.addWorker();
    this.processQueue();
  }

  private handleTimeout(state: WorkerState, taskId: string): void {
    // Only act if THIS task is still the one in flight (guards against a late timer).
    if (state.currentTaskId !== taskId) return;
    console.error(
      `[WorkerPool] Task ${taskId} timed out after ${TASK_TIMEOUT_MS}ms; terminating wedged worker`,
    );
    this.failCurrentTask(state, new Error(`Worker task timed out after ${TASK_TIMEOUT_MS}ms`));
    this.replaceWorker(state);
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const idleWorker = this.workers.find((w) => !w.busy);
      if (!idleWorker) break;

      const pending = this.taskQueue.shift()!;
      this.dispatchToWorker(idleWorker, pending);
    }
  }

  private dispatchToWorker(state: WorkerState, pending: PendingTask): void {
    state.busy = true;
    state.currentTaskId = pending.task.id;
    this.pendingTasks.set(pending.task.id, {
      resolve: pending.resolve,
      reject: pending.reject,
    });
    state.timer = setTimeout(() => this.handleTimeout(state, pending.task.id), TASK_TIMEOUT_MS);

    // Send a copy via structured clone — do NOT use a transferList. A small
    // Buffer is backed by Node's shared 8KB pool, whose ArrayBuffer is not
    // transferable and makes postMessage throw "Cannot transfer object of
    // unsupported type" (which then fails the conversion). The copy is cheap
    // relative to the conversion and correct for every file size.
    state.worker.postMessage({ ...pending.task, buffer: Buffer.from(pending.task.buffer) });
  }

  async runTask(type: WorkerTaskType, buffer: Buffer, format: BookFormat): Promise<unknown> {
    const id = `task-${++taskIdCounter}`;
    const task: WorkerTask = { id, type, buffer, format };

    return new Promise<unknown>((resolve, reject) => {
      const pending: PendingTask = { task, resolve, reject };
      const idleWorker = this.workers.find((w) => !w.busy);

      if (idleWorker) {
        this.dispatchToWorker(idleWorker, pending);
      } else {
        this.taskQueue.push(pending);
      }
    });
  }

  async shutdown(): Promise<void> {
    for (const state of this.workers) this.clearTimer(state);
    const terminations = this.workers.map((state) => state.worker.terminate());
    await Promise.all(terminations);
    this.workers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
    console.log("[WorkerPool] Shut down");
  }
}

// Singleton pool instance
let pool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool();
  }
  return pool;
}

export function isWorkerAvailable(): boolean {
  return getWorkerPath() !== null;
}
