/**
 * Modules index file
 * Registers all feature modules
 */
import { getLogger } from '../logging';
import { initializeTodoModule } from './todos';

const logger = getLogger('Modules');

/**
 * Initialize all modules
 */
export function initializeModules(): void {
  logger.info('Initializing all modules');
  
  // Initialize Todo module
  initializeTodoModule();
  
  // Initialize other modules as they are added
  // e.g. initializeCalendarModule();
  
  logger.info('All modules initialized');
}

export default {
  initialize: initializeModules
};