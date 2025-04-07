/**
 * Main IPC handlers
 * Registers all IPC handlers for the main process
 */
import { ipcMain } from 'electron';
import { getLogger } from '../logging';
import { syncCoordinator } from '../sync';
import { SYNC_CHANNELS } from './channels';

const logger = getLogger('IPCHandlers');

/**
 * Register sync-related IPC handlers
 */
export function registerSyncHandlers(): void {
  logger.info('Registering sync IPC handlers');
  
  // Get sync status
  ipcMain.handle(SYNC_CHANNELS.GET_STATUS, () => {
    logger.debug('IPC: sync:status called');
    return syncCoordinator.getStatus();
  });
  
  // Force sync
  ipcMain.handle(SYNC_CHANNELS.FORCE_SYNC, async () => {
    logger.debug('IPC: sync:force called');
    return syncCoordinator.forceSync();
  });
}

/**
 * Unregister sync-related IPC handlers
 */
export function unregisterSyncHandlers(): void {
  logger.info('Unregistering sync IPC handlers');
  
  ipcMain.removeHandler(SYNC_CHANNELS.GET_STATUS);
  ipcMain.removeHandler(SYNC_CHANNELS.FORCE_SYNC);
}

/**
 * Register all IPC handlers
 */
export function registerAllHandlers(): void {
  logger.info('Registering all IPC handlers');
  
  // Sync handlers are registered directly here
  registerSyncHandlers();
  
  // Module-specific handlers are registered by their respective modules
  // See modules/todos/todo.ipc.ts for example
}

/**
 * Unregister all IPC handlers
 */
export function unregisterAllHandlers(): void {
  logger.info('Unregistering all IPC handlers');
  
  unregisterSyncHandlers();
  
  // Module-specific handlers should be unregistered by their respective modules
}