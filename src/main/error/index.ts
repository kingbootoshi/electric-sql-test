/**
 * Error module index file
 * Exports all error types and utility functions
 */
export * from './app.error';

/**
 * Utility to handle errors consistently
 * Logs the error and optionally sends it to the renderer
 */
import { getLogger } from '../logging';
import { BrowserWindow } from 'electron';
import { AppError } from './app.error';

const logger = getLogger('ErrorHandler');

export function handleError(error: Error | AppError, notifyRenderer: boolean = false): void {
  // Log the error
  if (error instanceof AppError) {
    logger.error(`${error.name} (${error.code}): ${error.message}`, { stack: error.stack });
  } else {
    logger.error(`Unhandled error: ${error.message}`, { stack: error.stack });
  }
  
  // Notify renderer if needed
  if (notifyRenderer) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      const errorMessage = error instanceof AppError ? 
        { message: error.message, code: error.code, name: error.name } : 
        { message: error.message, name: error.name };
      
      mainWindow.webContents.send('app-error', errorMessage);
    }
  }
}

/**
 * Wraps an async function with error handling
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  notifyRenderer: boolean = false
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), notifyRenderer);
      throw error;
    }
  };
}