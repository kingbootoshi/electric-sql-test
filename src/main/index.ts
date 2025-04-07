/**
 * Main Entry Point
 * Initializes all application components
 */
import { getLogger } from './logging';
import * as core from './core';
import * as ipc from './ipc';
import { syncCoordinator } from './sync';
import { initializeModules } from './modules';

// Initialize logger first
const logger = getLogger('Main');

/**
 * Bootstrap the application
 * Initialize all services in the correct order
 */
async function bootstrap() {
  try {
    logger.info('Starting application bootstrap');
    
    // Initialize IPC first (so handlers are ready)
    ipc.initializeIpc();
    logger.info('IPC initialized');
    
    // Initialize modules (registers their IPC handlers)
    initializeModules();
    logger.info('Modules initialized');
    
    // Initialize sync coordinator (after database is ready)
    await syncCoordinator.initialize();
    logger.info('Sync coordinator initialized');
    
    // Initialize core app (event listeners, etc.)
    core.initialize();
    logger.info('Core initialized');
    
    logger.info('Application bootstrap complete');
  } catch (error) {
    logger.error('Error during application bootstrap', error);
    process.exit(1);
  }
}

// Start the application
bootstrap().catch(error => {
  logger.error('Unhandled error during bootstrap', error);
  process.exit(1);
});