/**
 * IPC module index file
 */
import { getLogger } from '../logging';
import { registerAllHandlers, unregisterAllHandlers } from './main.handlers';

export * from './channels';
export * from './main.handlers';

const logger = getLogger('IPC');

/**
 * Initialize IPC
 */
export function initializeIpc(): void {
  logger.info('Initializing IPC');
  registerAllHandlers();
}

/**
 * Clean up IPC
 */
export function cleanupIpc(): void {
  logger.info('Cleaning up IPC');
  unregisterAllHandlers();
}

export default {
  initialize: initializeIpc,
  cleanup: cleanupIpc
};