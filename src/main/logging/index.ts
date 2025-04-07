/**
 * Logging module index file
 * Exports the logger and convenience methods
 */
import { rootLogger } from './logger';

// Export the root logger
export default rootLogger;

// Export the getLogger function as a convenience method
export function getLogger(module: string) {
  return rootLogger.getLogger(module);
}