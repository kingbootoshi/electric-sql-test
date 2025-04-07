/**
 * Sync coordinator
 * Central orchestrator for synchronization between local database and cloud
 */
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import configService from '../../config';
import { getLogger } from '../../logging';
import { DatabaseError, SyncError, NetworkError } from '../../error/app.error';
import { sqliteService } from '../../database';
import { electricClient, shapeProcessor, ProcessedShapeEntry } from '../electric';
import { supabaseService } from '../supabase';
import { offlineStorageService } from '../offline';
import { connectionMonitor, ConnectionStatus } from './connection.monitor';
import { Todo } from '../../../@types/todo';

const logger = getLogger('SyncCoordinator');

/**
 * Sync result interface
 */
export interface SyncResult {
  received: number;
  processed: number;
  inserts: number;
  updates: number;
  deletes: number;
}

/**
 * Pending operations result interface
 */
export interface PendingOperationsResult {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Sync coordinator events
 */
export interface SyncCoordinatorEvents {
  'sync-status-change': (status: ConnectionStatus) => void;
  'sync-completed': (result: SyncResult) => void;
  'pending-operations-processed': (result: PendingOperationsResult) => void;
  'data-changed': () => void;
}

/**
 * Sync coordinator class
 * Central manager for synchronization
 */
export class SyncCoordinator extends EventEmitter {
  private syncStatus: ConnectionStatus = 'offline';
  private lastSyncTime: number = 0;
  private syncInterval: number;
  private syncIntervalTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  
  constructor() {
    super();
    
    // Get sync interval from config
    this.syncInterval = configService.getOrDefault('SYNC_INTERVAL', 30000, 'number');
    
    logger.info(`Initializing sync coordinator with interval: ${this.syncInterval}ms`);
    
    // Setup connection monitor event handlers
    this.setupConnectionMonitor();
  }
  
  /**
   * Initialize the sync coordinator
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing sync coordinator');
    
    try {
      // Initialize Electric client
      await electricClient.initialize();
      
      // Start connection monitor
      connectionMonitor.start();
      
      // Get initial sync status
      this.syncStatus = connectionMonitor.getStatus();
      
      // Start periodic sync if online
      if (this.syncStatus === 'online') {
        this.startPeriodicSync();
        
        // Initial sync
        await this.syncWithSupabase();
      }
      
      logger.info(`Sync coordinator initialized, status: ${this.syncStatus}`);
    } catch (error) {
      logger.error('Failed to initialize sync coordinator', error);
      throw new SyncError(`Failed to initialize sync coordinator: ${(error as Error).message}`);
    }
  }
  
  /**
   * Set up connection monitor event handlers
   */
  private setupConnectionMonitor(): void {
    connectionMonitor.on('status-change', async (status, previousStatus) => {
      logger.info(`Connection status changed: ${previousStatus} → ${status}`);
      
      // Update internal status
      this.syncStatus = status;
      
      // Notify renderer of status change
      this.notifyRendererStatusChange(status);
      
      // Handle transitions
      if (previousStatus === 'offline' && status === 'online') {
        logger.info('Connection restored, processing pending operations and syncing');
        this.startPeriodicSync();
        
        try {
          // Process pending operations if Supabase is online
          if (connectionMonitor.isSupabaseOnline()) {
            await this.processPendingOperations();
          }
          
          // Sync with Supabase if Electric is online
          if (connectionMonitor.isElectricOnline()) {
            await this.syncWithSupabase();
          }
        } catch (error) {
          logger.error('Error processing operations or syncing after connection restored', error);
        }
      } 
      else if (previousStatus === 'online' && status === 'offline') {
        logger.info('Connection lost, stopping periodic sync');
        this.stopPeriodicSync();
      }
    });
    
    // Listen for electric-specific status changes
    connectionMonitor.on('electric-status-change', async (isOnline) => {
      if (isOnline && this.syncStatus === 'online' && !this.isSyncing) {
        logger.info('Electric came online, triggering sync');
        await this.syncWithSupabase();
      }
    });
    
    // Listen for supabase-specific status changes
    connectionMonitor.on('supabase-status-change', async (isOnline) => {
      if (isOnline && this.syncStatus === 'online' && offlineStorageService.hasPendingOperations()) {
        logger.info('Supabase came online and we have pending operations, processing them');
        await this.processPendingOperations();
      }
    });
  }
  
  /**
   * Start periodic sync with Supabase
   */
  private startPeriodicSync(): void {
    if (this.syncIntervalTimer) {
      this.stopPeriodicSync();
    }
    
    logger.info(`Starting periodic sync every ${this.syncInterval / 1000} seconds`);
    
    this.syncIntervalTimer = setInterval(async () => {
      if (this.syncStatus === 'online' && !this.isSyncing) {
        const currentTime = Date.now();
        
        // Only sync if it's been at least syncInterval since last sync
        if (!this.lastSyncTime || (currentTime - this.lastSyncTime) > this.syncInterval) {
          logger.info('Periodic sync triggered');
          
          try {
            await this.syncWithSupabase();
          } catch (error) {
            logger.error('Periodic sync error', error);
          }
        }
      }
    }, this.syncInterval);
  }
  
  /**
   * Stop periodic sync
   */
  private stopPeriodicSync(): void {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
      logger.info('Stopped periodic sync');
    }
  }
  
  /**
   * Process pending operations when coming back online
   */
  public async processPendingOperations(): Promise<PendingOperationsResult> {
    const pendingOps = offlineStorageService.getPendingOperations();
    
    const result: PendingOperationsResult = {
      total: pendingOps.length,
      processed: 0,
      succeeded: 0,
      failed: 0
    };
    
    if (pendingOps.length === 0) {
      logger.info('No pending operations to process');
      this.emit('pending-operations-processed', result);
      return result;
    }
    
    logger.info(`Processing ${pendingOps.length} pending operations`);
    
    // Set status to syncing
    const previousStatus = this.syncStatus;
    this.syncStatus = 'syncing';
    this.notifyRendererStatusChange('syncing');
    connectionMonitor.setSyncing();
    
    // Verify Supabase connection
    try {
      const isConnected = await supabaseService.checkConnection();
      if (!isConnected) {
        logger.error('Supabase connection check failed, cannot process pending operations');
        
        // Revert status
        this.syncStatus = previousStatus;
        this.notifyRendererStatusChange(previousStatus);
        connectionMonitor.syncCompleted();
        
        this.emit('pending-operations-processed', result);
        return result;
      }
    } catch (error) {
      logger.error('Error checking Supabase connection', error);
      
      // Revert status
      this.syncStatus = previousStatus;
      this.notifyRendererStatusChange(previousStatus);
      connectionMonitor.syncCompleted();
      
      this.emit('pending-operations-processed', result);
      return result;
    }
    
    // Process operations by type to ensure correct order (creates before updates before deletes)
    const creates = pendingOps.filter(op => op.type === 'create');
    const updates = pendingOps.filter(op => op.type === 'update');
    const deletes = pendingOps.filter(op => op.type === 'delete');
    
    // Process in order: creates, updates, deletes
    const allOperations = [...creates, ...updates, ...deletes];
    
    for (const op of allOperations) {
      try {
        let success = false;
        
        switch (op.type) {
          case 'create':
            logger.info(`Processing create operation for todo ${op.todoId}`);
            success = await supabaseService.createTodo(op.data as Todo);
            break;
            
          case 'update':
            logger.info(`Processing update operation for todo ${op.todoId}`);
            success = await supabaseService.updateTodo(op.todoId, op.data);
            break;
            
          case 'delete':
            logger.info(`Processing delete operation for todo ${op.todoId}`);
            success = await supabaseService.deleteTodo(op.todoId);
            break;
        }
        
        result.processed++;
        
        if (success) {
          // Clear the operation after successful sync
          offlineStorageService.clearPendingOperation(op.todoId, op.type);
          result.succeeded++;
          logger.debug(`Successfully processed ${op.type} operation for todo ${op.todoId}`);
        } else {
          result.failed++;
          logger.error(`Failed to process ${op.type} operation for todo ${op.todoId}`);
        }
      } catch (error) {
        result.processed++;
        result.failed++;
        logger.error(`Error processing ${op.type} operation for todo ${op.todoId}`, error);
        
        // If it's a network error, stop processing
        if (error instanceof NetworkError) {
          logger.error('Network error detected, stopping pending operations processing');
          break;
        }
      }
    }
    
    logger.info(`Completed processing pending operations: ${result.succeeded} succeeded, ${result.failed} failed`);
    
    // Notify renderer that data might have changed
    if (result.succeeded > 0) {
      this.notifyRendererDataChanged();
    }
    
    // Restore status based on connection monitor
    connectionMonitor.syncCompleted();
    this.syncStatus = connectionMonitor.getStatus();
    this.notifyRendererStatusChange(this.syncStatus);
    
    // Emit event
    this.emit('pending-operations-processed', result);
    
    return result;
  }
  
  /**
   * Sync with Supabase via ElectricSQL
   */
  public async syncWithSupabase(): Promise<SyncResult> {
    if (this.isSyncing) {
      logger.info('Sync already in progress, skipping');
      return {
        received: 0,
        processed: 0,
        inserts: 0,
        updates: 0,
        deletes: 0
      };
    }
    
    this.isSyncing = true;
    
    try {
      this.syncStatus = 'syncing';
      this.notifyRendererStatusChange('syncing');
      connectionMonitor.setSyncing();
      
      logger.info('Starting sync from Supabase via Electric');
      
      // Fetch shape log entries
      const rawEntries = await electricClient.fetchShapeLog();
      
      // Process shape log entries
      const processedEntries = shapeProcessor.processShapeLogEntries(rawEntries);
      
      const result: SyncResult = {
        received: processedEntries.length,
        processed: 0,
        inserts: 0,
        updates: 0,
        deletes: 0
      };
      
      if (processedEntries.length > 0) {
        logger.info(`Processing ${processedEntries.length} synced changes`);
        
        try {
          // Apply changes to local database
          const applyResult = await this.applyChangesToDb(processedEntries);
          
          result.processed = applyResult.total;
          result.inserts = applyResult.inserts;
          result.updates = applyResult.updates;
          result.deletes = applyResult.deletes;
          
          logger.info(`Sync applied: ${result.inserts} inserted/replaced, ${result.updates} updated, ${result.deletes} deleted`);
          
          // Notify renderer that data changed if any changes were applied
          if (result.inserts > 0 || result.updates > 0 || result.deletes > 0) {
            this.notifyRendererDataChanged();
          }
        } catch (error) {
          logger.error('Error applying changes to database', error);
          throw new SyncError(`Error applying changes to database: ${(error as Error).message}`);
        }
      } else {
        logger.info('Sync successful but no new data changes to process');
      }
      
      // Update last sync time
      this.lastSyncTime = Date.now();
      
      // Emit sync completed event
      this.emit('sync-completed', result);
      
      // Restore status based on connection monitor
      connectionMonitor.syncCompleted();
      this.syncStatus = connectionMonitor.getStatus();
      this.notifyRendererStatusChange(this.syncStatus);
      
      return result;
    } catch (error) {
      logger.error('Sync error', error);
      
      // Check if it's a network error
      if (error instanceof NetworkError) {
        logger.error('Network error detected during sync');
        
        // Force a connection recheck
        await connectionMonitor.forceCheck();
        this.syncStatus = connectionMonitor.getStatus();
      } else {
        logger.error('API error during sync');
        
        // Update status based on connection status
        this.syncStatus = connectionMonitor.getStatus();
      }
      
      // Notify renderer of status change
      this.notifyRendererStatusChange(this.syncStatus);
      
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }
  
  /**
   * Apply changes to local database
   * @param entries Processed shape entries
   */
  private async applyChangesToDb(entries: ProcessedShapeEntry[]): Promise<{
    total: number;
    inserts: number;
    updates: number;
    deletes: number;
  }> {
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    
    try {
      // Use transaction for atomicity
      sqliteService.transaction(db => {
        // Prepare statements outside the loop for efficiency
        const insertStmt = db.prepare(
          `INSERT OR REPLACE INTO todos (id, title, completed, created_at) VALUES (?, ?, ?, ?)`
        );
        const deleteStmt = db.prepare(`DELETE FROM todos WHERE id = ?`);
        
        for (const entry of entries) {
          try {
            switch (entry.operation) {
              case 'insert':
                if (entry.value) {
                  insertStmt.run(
                    entry.id,
                    entry.value.title || '',
                    entry.value.completed === 'true' || entry.value.completed === true ? 1 : 0,
                    entry.value.created_at || new Date().toISOString()
                  );
                  inserted++;
                } else {
                  logger.warn(`Skipping insert for ${entry.id} due to missing value`);
                }
                break;
                
              case 'update':
                if (entry.value) {
                  // Build SET clause dynamically based on available fields
                  const updates: string[] = [];
                  const params: any[] = [];
                  
                  if (entry.value.hasOwnProperty('title')) {
                    updates.push('title = ?');
                    params.push(entry.value.title);
                  }
                  
                  if (entry.value.hasOwnProperty('completed')) {
                    updates.push('completed = ?');
                    params.push(entry.value.completed === 'true' || entry.value.completed === true ? 1 : 0);
                  }
                  
                  if (entry.value.hasOwnProperty('created_at')) {
                    updates.push('created_at = ?');
                    params.push(entry.value.created_at);
                  }
                  
                  if (updates.length > 0) {
                    params.push(entry.id); // Add id for WHERE clause
                    const sql = `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`;
                    const updateStmt = db.prepare(sql);
                    const info = updateStmt.run(...params);
                    if (info.changes > 0) updated++;
                    else logger.warn(`Update for ${entry.id} affected 0 rows`);
                  } else {
                    logger.warn(`Skipping update for ${entry.id}, no fields in value`);
                  }
                } else {
                  logger.warn(`Skipping update for ${entry.id} due to missing value`);
                }
                break;
                
              case 'delete':
                const info = deleteStmt.run(entry.id);
                if (info.changes > 0) deleted++;
                else logger.warn(`Delete for ${entry.id} affected 0 rows (may have been deleted already)`);
                break;
            }
          } catch (dbError) {
            logger.error(`Error applying ${entry.operation} for todo ${entry.id}`, dbError);
          }
        }
      });
      
      return {
        total: inserted + updated + deleted,
        inserts: inserted,
        updates: updated,
        deletes: deleted
      };
    } catch (error) {
      logger.error('Error applying changes to database', error);
      throw new DatabaseError(`Failed to apply changes to database: ${(error as Error).message}`);
    }
  }
  
  /**
   * Force a sync
   */
  public async forceSync(): Promise<{
    electric: string;
    supabase: string;
    operations: PendingOperationsResult;
    sync: SyncResult;
  }> {
    logger.info('Force sync requested');
    
    // Check both Electric and Supabase connections
    const isElectricOnline = await electricClient.checkConnection();
    electricClient.setConnectionStatus(isElectricOnline);
    
    const isSupabaseOnline = await supabaseService.checkConnection();
    
    const result: any = {
      electric: isElectricOnline ? 'connected' : 'disconnected',
      supabase: isSupabaseOnline ? 'connected' : 'disconnected',
      operations: {
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0
      },
      sync: {
        received: 0,
        processed: 0,
        inserts: 0,
        updates: 0,
        deletes: 0
      }
    };
    
    // Update UI status based on combined status
    const isAppOnline = isElectricOnline || isSupabaseOnline;
    this.syncStatus = isAppOnline ? 'online' : 'offline';
    this.notifyRendererStatusChange(this.syncStatus);
    
    // Process pending operations if Supabase is available
    if (isSupabaseOnline) {
      logger.info('Processing pending operations...');
      
      try {
        // Process any pending operations first
        const pendingOpsResult = await this.processPendingOperations();
        result.operations = pendingOpsResult;
      } catch (error) {
        logger.error('Error processing pending operations', error);
      }
    }
    
    // Then sync with Supabase if Electric is available
    if (isElectricOnline) {
      logger.info('Syncing with Supabase via Electric...');
      
      try {
        const syncResult = await this.syncWithSupabase();
        result.sync = syncResult;
        
        // Update last sync time
        this.lastSyncTime = Date.now();
      } catch (error) {
        logger.error('Error syncing with Supabase', error);
      }
    }
    
    return result;
  }
  
  /**
   * Notify renderer of sync status change
   * @param status The current sync status
   */
  private notifyRendererStatusChange(status: ConnectionStatus): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('sync-status-change', status);
      logger.debug(`Notified renderer of sync status change: ${status}`);
    }
  }
  
  /**
   * Notify renderer that data has changed
   */
  private notifyRendererDataChanged(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('todos-updated');
      logger.debug('Notified renderer of data changes');
    }
    
    // Also emit local event
    this.emit('data-changed');
  }
  
  /**
   * Get the current sync status
   * @returns The current sync status
   */
  public getStatus(): ConnectionStatus {
    return this.syncStatus;
  }
  
  /**
   * Override TypeScript's default on method for better type checking
   */
  public on<E extends keyof SyncCoordinatorEvents>(
    event: E, 
    listener: SyncCoordinatorEvents[E]
  ): this {
    return super.on(event, listener as any);
  }
  
  /**
   * Override TypeScript's default emit method for better type checking
   */
  public emit<E extends keyof SyncCoordinatorEvents>(
    event: E, 
    ...args: Parameters<SyncCoordinatorEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    logger.info('Disposing sync coordinator');
    
    // Stop periodic sync
    this.stopPeriodicSync();
    
    // Stop connection monitor
    connectionMonitor.stop();
    
    // Clean up electric client
    electricClient.dispose();
  }
}

// Export as singleton
export const syncCoordinator = new SyncCoordinator();
export default syncCoordinator;