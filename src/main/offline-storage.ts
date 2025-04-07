// Offline storage manager for ElectricSQL sync
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface PendingOperation {
  type: 'create' | 'update' | 'delete';
  todoId: string;
  data?: any;
  timestamp: number;
}

export class OfflineStorageManager {
  private pendingOperationsPath: string;
  private pendingOperations: PendingOperation[] = [];

  constructor() {
    const userDataPath = app.getPath('userData');
    this.pendingOperationsPath = path.join(userDataPath, 'pending-operations.json');
    this.loadPendingOperations();
  }

  // Add a pending operation when offline
  public addPendingOperation(type: 'create' | 'update' | 'delete', todoId: string, data?: any): void {
    const operation: PendingOperation = {
      type,
      todoId,
      data,
      timestamp: Date.now()
    };

    this.pendingOperations.push(operation);
    this.savePendingOperations();
  }

  // Get all pending operations
  public getPendingOperations(): PendingOperation[] {
    return [...this.pendingOperations];
  }

  // Clear a specific pending operation
  public clearPendingOperation(todoId: string, type?: 'create' | 'update' | 'delete'): void {
    if (type) {
      this.pendingOperations = this.pendingOperations.filter(
        op => !(op.todoId === todoId && op.type === type)
      );
    } else {
      this.pendingOperations = this.pendingOperations.filter(
        op => op.todoId !== todoId
      );
    }
    
    this.savePendingOperations();
  }

  // Clear all pending operations
  public clearAllPendingOperations(): void {
    this.pendingOperations = [];
    this.savePendingOperations();
  }

  // Save pending operations to file
  private savePendingOperations(): void {
    try {
      fs.writeFileSync(
        this.pendingOperationsPath,
        JSON.stringify(this.pendingOperations, null, 2)
      );
    } catch (error) {
      console.error('Failed to save pending operations:', error);
    }
  }

  // Load pending operations from file
  private loadPendingOperations(): void {
    try {
      if (fs.existsSync(this.pendingOperationsPath)) {
        const data = fs.readFileSync(this.pendingOperationsPath, 'utf8');
        this.pendingOperations = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load pending operations:', error);
      this.pendingOperations = [];
    }
  }
}
