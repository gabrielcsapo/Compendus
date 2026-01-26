/**
 * Utility functions for processing operations
 */

/**
 * Suppress console output during the execution of a function.
 * This is useful for libraries that output verbose logs we don't need.
 */
export async function suppressConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalDebug = console.debug;

  // Replace console methods with no-ops
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};

  try {
    return await fn();
  } finally {
    // Restore original console methods
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.debug = originalDebug;
  }
}

/**
 * Yield to the event loop to prevent blocking.
 * Use this between CPU-intensive operations.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run a function in the background with yielding to prevent blocking.
 * Uses setTimeout instead of setImmediate to better yield to the event loop.
 */
export function scheduleBackground(fn: () => Promise<void>): void {
  setTimeout(async () => {
    try {
      await fn();
    } catch {
      // Background processing failed silently
    }
  }, 10); // Small delay to ensure main thread can respond
}
