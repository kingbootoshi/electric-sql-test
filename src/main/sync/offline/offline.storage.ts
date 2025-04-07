/**
 * Offline storage manager
 * Responsible for managing operations performed while offline
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import configService from '../../config';
import { getLogger } from '../../logging';
import { OfflineError } from '../../error/app.error';

const logger = getLogger('OfflineStorage');

/**
 * Pending operation interface
 */
export interface PendingOperation {
  type: 'create' | 'update' | 'delete';
  todoId: string;
  data?: any;
  timestamp: number;
}

/**
 * Offline storage service
 */
export class OfflineStorageService {
  private pendingOperationsPath: string;
  private pendingOperations: PendingOperation[] = [];
  
  constructor() {
    this.pendingOperationsPath = configService.getOrDefault(
      'OFFLINE_STORAGE_PATH',
      path.join(app.getPath('userData'), 'pending-operations.json')
    );
    
    logger.info(`Initializing offline storage with path: ${this.pendingOperationsPath}`);
    this.loadPendingOperations();
  }
  
  /**
   * Add a pending operation when offline
   * @param type The operation type (create, update, delete)
   * @param todoId The ID of the todo
   * @param data The todo data (required for create/update)
   */
  public addPendingOperation(type: 'create' | 'update' | 'delete', todoId: string, data?: any): void {
    // Validate required data
    if ((type === 'create' || type === 'update') && !data) {
      logger.error(`Cannot add pending ${type} operation without data for todo ${todoId}`);
      throw new OfflineError(`Cannot add pending ${type} operation without data`);
    }
    
    logger.info(`Adding pending ${type} operation for todo ${todoId}`);
    
    // Create operation object
    const operation: PendingOperation = {
      type,
      todoId,
      data,
      timestamp: Date.now()
    };
    
    // Check for duplicates and replace if exists
    const existingIndex = this.pendingOperations.findIndex(
      op => op.todoId === todoId && op.type === type
    );
    
    if (existingIndex >= 0) {
      logger.debug(`Replacing existing pending ${type} operation for todo ${todoId}`);
      this.pendingOperations[existingIndex] = operation;
    } else {
      logger.debug(`Adding new pending ${type} operation for todo ${todoId}`);
      this.pendingOperations.push(operation);
    }
    
    // Save changes
    this.savePendingOperations();
  }
  
  /**
   * Get all pending operations
   * @returns Array of pending operations
   */
  public getPendingOperations(): PendingOperation[] {
    logger.debug(`Getting all pending operations (${this.pendingOperations.length})`);
    return [...this.pendingOperations];
  }
  
  /**
   * Get all pending operations of a specific type
   * @param type The operation type
   * @returns Array of pending operations of the specified type
   */
  public getPendingOperationsByType(type: 'create' | 'update' | 'delete'): PendingOperation[] {
    const operations = this.pendingOperations.filter(op => op.type === type);
    logger.debug(`Getting pending operations of type ${type} (${operations.length})`);
    return [...operations];
  }
  
  /**
   * Clear a specific pending operation
   * @param todoId The ID of the todo
   * @param type Optional operation type (if not specified, clears all operations for the todo)
   */
  public clearPendingOperation(todoId: string, type?: 'create' | 'update' | 'delete'): void {
    const initialCount = this.pendingOperations.length;
    
    if (type) {
      logger.info(`Clearing pending ${type} operation for todo ${todoId}`);
      this.pendingOperations = this.pendingOperations.filter(
        op => !(op.todoId === todoId && op.type === type)
      );
    } else {
      logger.info(`Clearing all pending operations for todo ${todoId}`);
      this.pendingOperations = this.pendingOperations.filter(
        op => op.todoId !== todoId
      );
    }
    
    const clearedCount = initialCount - this.pendingOperations.length;
    logger.debug(`Cleared ${clearedCount} pending operations`);
    
    // Save changes if any operations were removed
    if (clearedCount > 0) {
      this.savePendingOperations();
    }
  }
  
  /**
   * Clear all pending operations
   */
  public clearAllPendingOperations(): void {
    logger.info(`Clearing all ${this.pendingOperations.length} pending operations`);
    this.pendingOperations = [];
    this.savePendingOperations();
  }
  
  /**
   * Save pending operations to file
   */
  private savePendingOperations(): void {
    try {
      // Create directory if it doesn't exist
      const dirPath = path.dirname(this.pendingOperationsPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      fs.writeFileSync(
        this.pendingOperationsPath,
        JSON.stringify(this.pendingOperations, null, 2)
      );
      logger.debug(`Saved ${this.pendingOperations.length} pending operations to storage`);
    } catch (error) {
      logger.error('Failed to save pending operations', error);
      throw new OfflineError(`Failed to save pending operations: ${(error as Error).message}`);
    }
  }
  
  /**
   * Load pending operations from file
   */
  private loadPendingOperations(): void {
    try {
      if (fs.existsSync(this.pendingOperationsPath)) {
        const data = fs.readFileSync(this.pendingOperationsPath, 'utf8');
        this.pendingOperations = JSON.parse(data);
        logger.info(`Loaded ${this.pendingOperations.length} pending operations from storage`);
      } else {
        logger.info('No pending operations file found, starting with empty queue');
        this.pendingOperations = [];
      }
    } catch (error) {
      logger.error('Failed to load pending operations', error);
      this.pendingOperations = [];
    }
  }
  
  /**
   * Check if there are any pending operations
   * @returns True if there are pending operations, false otherwise
   */
  public hasPendingOperations(): boolean {
    return this.pendingOperations.length > 0;
  }
  
  /**
   * Get the count of pending operations
   * @returns The number of pending operations
   */
  public getPendingOperationsCount(): number {
    return this.pendingOperations.length;
  }
}

// Export as singleton
export const offlineStorageService = new OfflineStorageService();
export default offlineStorageService;