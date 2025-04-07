/**
 * App Core
 * Manages the application lifecycle events
 */
import { app, BrowserWindow } from 'electron';
import { getLogger } from '../logging';
import { createMainWindow } from './main.window';
import { cleanupIpc } from '../ipc';
import { syncCoordinator } from '../sync';
import { sqliteService } from '../database';

const logger = getLogger('AppCore');

/**
 * Initialize the app
 */
export function initialize(): void {
  logger.info('Initializing application');
  
  // When Electron has finished initialization
  app.whenReady().then(() => {
    logger.info('App ready');
    createMainWindow();
    
    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
  
  // Quit when all windows are closed, except on macOS
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      logger.info('All windows closed, quitting app');
      app.quit();
    }
  });
  
  // Clean up on quit
  app.on('quit', () => {
    logger.info('App quitting, cleaning up resources');
    
    // Clean up IPC handlers
    cleanupIpc();
    
    // Clean up sync coordinator
    syncCoordinator.dispose();
    
    // Close database connection
    sqliteService.close();
    
    logger.info('Cleanup complete');
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
  });
}