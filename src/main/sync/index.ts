/**
 * Sync module index file
 * Exports all sync-related components
 */
import { electricClient, shapeProcessor } from './electric';
import { supabaseService } from './supabase';
import { offlineStorageService } from './offline';
import { connectionMonitor, syncCoordinator } from './coordinator';

// Re-export key types
import type { ProcessedShapeEntry } from './electric';
import type { PendingOperation } from './offline';
import type { ConnectionStatus, SyncResult, PendingOperationsResult } from './coordinator';

// Re-export types
export type {
  ProcessedShapeEntry,
  PendingOperation,
  ConnectionStatus,
  SyncResult,
  PendingOperationsResult
};

// Re-export classes
export * from './electric';
export * from './supabase';
export * from './offline';
export * from './coordinator';

// Export service instances
export {
  electricClient,
  shapeProcessor,
  supabaseService,
  offlineStorageService,
  connectionMonitor,
  syncCoordinator
};

// Export as a single service
export default syncCoordinator;