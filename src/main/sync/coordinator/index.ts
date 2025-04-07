/**
 * Coordinator module index file
 * Exports the connection monitor and sync coordinator
 */
import { 
  connectionMonitor, 
  ConnectionMonitor
} from './connection.monitor';
import type { ConnectionStatus } from './connection.monitor';

import { 
  syncCoordinator, 
  SyncCoordinator
} from './sync.coordinator';
import type { SyncResult, PendingOperationsResult } from './sync.coordinator';

export { ConnectionMonitor, connectionMonitor, SyncCoordinator, syncCoordinator };
export type { ConnectionStatus, SyncResult, PendingOperationsResult };

export default {
  connectionMonitor,
  syncCoordinator
};
