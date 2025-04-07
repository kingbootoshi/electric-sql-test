/**
 * Offline module index file
 * Exports the offline storage service and types
 */
import { offlineStorageService, OfflineStorageService } from './offline.storage';
import type { PendingOperation } from './offline.storage';

export { OfflineStorageService, offlineStorageService };
export type { PendingOperation };

export default offlineStorageService;
