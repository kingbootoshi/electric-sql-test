import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ElectricSQL client for syncing with Supabase
export class ElectricClient {
  private electricUrl: string;
  private isOnline: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private localStoragePath: string;
  private syncOffset: string = '-1';
  private syncHandle: string = '';

  constructor() {
    this.electricUrl = process.env.ELECTRIC_URL || 'http://localhost:5133';
    this.localStoragePath = path.join(app.getPath('userData'), 'electric-sync.json');
    this.loadSyncState();
  }

  // Initialize the sync client
  public async initialize(): Promise<void> {
    try {
      // Check if we're online
      this.isOnline = await this.checkConnection();
      
      // Start sync interval
      this.startSyncInterval();
      
      console.log('ElectricSQL client initialized, online status:', this.isOnline);
      return Promise.resolve();
    } catch (error) {
      console.error('Failed to initialize ElectricSQL client:', error);
      this.isOnline = false;
      return Promise.reject(error);
    }
  }

  // Check if we can connect to the Electric service
  public async checkConnection(): Promise<boolean> {
    try {
      // Try the root endpoint first (according to ElectricSQL HTTP API)
      const response = await fetch(`${this.electricUrl}/`, {
        signal: AbortSignal.timeout(3000),
        headers: {
          'Accept': 'application/json'
        }
      });
      
      // Consider any successful response (2xx) as online
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      console.warn('Electric service not reachable:', error);
      return false;
    }
  }

  // Start periodic sync
  private startSyncInterval(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    // Sync every 30 seconds if online
    this.syncInterval = setInterval(async () => {
      console.log('[ElectricClient.startSyncInterval] Checking if sync needed');
      
      // Double-check connection status before syncing
      this.isOnline = await this.checkConnection();
      
      if (this.isOnline) {
        try {
          console.log('[ElectricClient.startSyncInterval] Attempting sync');
          const todos = await this.syncTodos();
          console.log(`[ElectricClient.startSyncInterval] Sync successful, received ${todos.length} todos`);
        } catch (error) {
          console.error('[ElectricClient.startSyncInterval] Sync error:', error);
          
          // If we get a 400 error with the current offset, reset to initial sync
          if (error.message && error.message.includes('400')) {
            console.warn('[ElectricClient.startSyncInterval] Got 400 error, resetting sync offset');
            this.syncOffset = '-1';
            this.saveSyncState();
          }
        }
      } else {
        console.log('[ElectricClient.startSyncInterval] Not online, skipping sync');
      }
    }, 30000);
  }

  // Sync todos with Supabase via Electric
  public async syncTodos(): Promise<any[]> { // Return specifically an array
    if (!this.isOnline) {
      console.log('[ElectricClient.syncTodos] Skipping sync, not online.');
      return []; // Return empty array instead of throwing
    }

    // Add handle parameter if we have one
    let url = `${this.electricUrl}/v1/shape?table=todos&offset=${this.syncOffset}`;
    if (this.syncHandle) {
      url += `&handle=${this.syncHandle}`;
    }
    
    const options = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // Longer timeout for sync operations
    };

    console.log(`[ElectricClient.syncTodos] Requesting shape data with offset: ${this.syncOffset}`);
    if (this.syncHandle) {
      console.log(`[ElectricClient.syncTodos] Using handle: ${this.syncHandle}`);
    }
    
    try {
      const response = await fetch(url, options);
      console.log(`[ElectricClient.syncTodos] Shape response status: ${response.status}`);
      
      // Log all headers for debugging
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      console.log('[ElectricClient.syncTodos] Response headers:', JSON.stringify(headers));
      
      // Check if response is successful (status 200-299)
      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (textError) {
          errorText = 'Could not read error response';
        }
        
        console.error(`[ElectricClient.syncTodos] Shape request failed with status ${response.status}: ${errorText}`);
        
        // If we get a 400 error, throw specific error
        if (response.status === 400) {
          throw new Error(`400 Bad Request: ${errorText}`);
        }
        
        this.isOnline = false; // Mark as offline on API error
        this.notifyStatusChange('offline'); // Notify status change
        return []; // Return empty array on error
      }
      
      // Extract sync metadata from headers (only if response is OK)
      const newOffset = response.headers.get('electric-offset');
      if (newOffset) {
        console.log(`[ElectricClient.syncTodos] Updated sync offset: ${newOffset}`);
        this.syncOffset = newOffset;
      } else {
        console.warn('[ElectricClient.syncTodos] No electric-offset header in response');
      }
      
      const newHandle = response.headers.get('electric-handle');
      if (newHandle) {
        console.log(`[ElectricClient.syncTodos] Updated sync handle: ${newHandle}`);
        this.syncHandle = newHandle;
      } else {
        console.warn('[ElectricClient.syncTodos] No electric-handle header in response');
      }

      // Save sync state after successful parsing
      this.saveSyncState();

      // Process the shape log entries (only if response is OK)
      let entries = [];
      try {
        entries = await response.json();
        console.log(`[ElectricClient.syncTodos] Received ${entries?.length ?? 0} shape log entries`);
      } catch (jsonError) {
        console.error('[ElectricClient.syncTodos] Failed to parse JSON response:', jsonError);
        return []; // Return empty array on parse error
      }
      
      return this.processShapeLogEntries(entries);
    } catch (error) {
      // Catch network errors or JSON parsing errors
      console.error('[ElectricClient.syncTodos] Failed to sync todos:', error);
      
      // Don't mark as offline for 400 errors (likely just invalid sync parameters)
      if (!(error.message && error.message.includes('400'))) {
        this.isOnline = false; // Mark as offline on network/parse error
        this.notifyStatusChange('offline');
      }
      
      throw error; // Rethrow to allow resetOffset logic in startSyncInterval
    }
  }
  
  // Helper to notify main process of status changes
  private notifyStatusChange(status: 'online' | 'offline' | 'syncing'): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('sync-status-change', status);
    }
  }

  // Process shape log entries from Electric
  private processShapeLogEntries(entries: any): any[] {
    const results: any[] = [];
    
    // Add defensive check for non-array input
    if (!Array.isArray(entries)) {
      console.warn('[ElectricClient.processShapeLogEntries] Received non-array input:', entries);
      return [];
    }
    
    try {
      for (const entry of entries) {
        // Skip control messages
        if (entry.headers && entry.headers.control) {
          console.log('[ElectricClient.processShapeLogEntries] Skipping control message:', entry.headers);
          continue;
        }
        
        // Process data entries with defensive checks
        if (entry && entry.value && entry.value.id) {
          results.push({
            id: entry.value.id,
            title: entry.value.title || '',
            completed: entry.value.completed === 'true' || entry.value.completed === true,
            created_at: entry.value.created_at || new Date().toISOString()
          });
        } else {
          console.warn('[ElectricClient.processShapeLogEntries] Skipping invalid entry:', entry);
        }
      }
    } catch (error) {
      console.error('[ElectricClient.processShapeLogEntries] Error processing entries:', error);
    }
    
    return results;
  }

  // Save sync state to local storage
  private saveSyncState(): void {
    const state = {
      syncOffset: this.syncOffset,
      syncHandle: this.syncHandle,
      lastSync: new Date().toISOString()
    };
    
    fs.writeFileSync(this.localStoragePath, JSON.stringify(state, null, 2));
  }

  // Load sync state from local storage
  private loadSyncState(): void {
    try {
      if (fs.existsSync(this.localStoragePath)) {
        const data = fs.readFileSync(this.localStoragePath, 'utf8');
        const state = JSON.parse(data);
        
        // Check if the stored state has valid values
        if (state.syncOffset && state.syncOffset !== 'undefined' && state.syncOffset !== 'null') {
          console.log(`[ElectricClient.loadSyncState] Loaded sync offset: ${state.syncOffset}`);
          this.syncOffset = state.syncOffset;
        } else {
          console.log('[ElectricClient.loadSyncState] No valid offset found, using default -1');
          this.syncOffset = '-1';
        }
        
        if (state.syncHandle && state.syncHandle !== 'undefined' && state.syncHandle !== 'null') {
          console.log(`[ElectricClient.loadSyncState] Loaded sync handle: ${state.syncHandle}`);
          this.syncHandle = state.syncHandle;
        } else {
          console.log('[ElectricClient.loadSyncState] No valid handle found, using empty string');
          this.syncHandle = '';
        }
        
        // Log last sync time if available
        if (state.lastSync) {
          const lastSyncTime = new Date(state.lastSync);
          const now = new Date();
          const diffMinutes = Math.floor((now.getTime() - lastSyncTime.getTime()) / (1000 * 60));
          console.log(`[ElectricClient.loadSyncState] Last sync was ${diffMinutes} minutes ago`);
        }
      } else {
        console.log('[ElectricClient.loadSyncState] No sync state file found, using defaults');
        this.syncOffset = '-1';
        this.syncHandle = '';
      }
    } catch (error) {
      console.warn('[ElectricClient.loadSyncState] Failed to load sync state:', error);
      this.syncOffset = '-1';
      this.syncHandle = '';
    }
  }

  // Write data to Electric
  public async writeTodo(todo: any): Promise<any> {
    if (!this.isOnline) {
      console.log('[ElectricClient.writeTodo] Skipping write, not online');
      return Promise.reject(new Error('Not online'));
    }

    try {
      // Prepare the request body
      let requestBody: any = {
        table: 'todos',
        values: {}
      };
      
      // Handle deletion case
      if (todo._deleted) {
        requestBody.values = {
          id: todo.id,
          _deleted: true
        };
        console.log(`[ElectricClient.writeTodo] Preparing to delete todo: ${todo.id}`);
      } else {
        // Handle create/update
        requestBody.values = {
          id: todo.id,
          title: todo.title || '',
          completed: todo.completed === true || todo.completed === 'true',
          created_at: todo.created_at || new Date().toISOString()
        };
        console.log(`[ElectricClient.writeTodo] Preparing to write todo: ${todo.id}`);
      }
      
      console.log('[ElectricClient.writeTodo] Write request payload:', JSON.stringify(requestBody));
      
      // Send the request with proper headers and timeout
      const response = await fetch(`${this.electricUrl}/v1/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000) // Longer timeout for write operations
      });
      
      console.log(`[ElectricClient.writeTodo] Write response status: ${response.status}`);
      
      if (response.ok) {
        try {
          const result = await response.json();
          console.log('[ElectricClient.writeTodo] Write response:', result);
          return result;
        } catch (jsonError) {
          console.warn('[ElectricClient.writeTodo] Could not parse JSON response:', jsonError);
          // If we can't parse JSON but the status was successful, still return success
          return { success: true };
        }
      } else {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (textError) {
          errorText = 'Could not read error response text';
        }
        
        console.error(`[ElectricClient.writeTodo] Write failed with status ${response.status}: ${errorText}`);
        this.isOnline = false;
        this.notifyStatusChange('offline');
        throw new Error(`Write failed with status ${response.status}: ${errorText}`);
      }
    } catch (error: any) {
      console.error('[ElectricClient.writeTodo] Failed to write todo:', error);
      
      // If this is a Header too long error, log more details
      if (error.message && error.message.includes('Header too long')) {
        console.error('[ElectricClient.writeTodo] Header too long error details:', error);
        console.error('[ElectricClient.writeTodo] Request body was:', JSON.stringify({
          table: 'todos',
          values: todo
        }));
      }
      
      this.isOnline = false; // Mark as offline on write failure
      this.notifyStatusChange('offline');
      return Promise.reject(error);
    }
  }

  // Get online status
  public isConnected(): boolean {
    return this.isOnline;
  }

  // Force a sync
  public async forceSync(): Promise<any[]> {
    // Verify connection before sync
    const wasOnline = this.isOnline;
    this.isOnline = await this.checkConnection();
    
    // Log status change if it changed
    if (wasOnline !== this.isOnline) {
      console.log(`[ElectricClient.forceSync] Connection status changed: ${wasOnline ? 'online' : 'offline'} → ${this.isOnline ? 'online' : 'offline'}`);
      this.notifyStatusChange(this.isOnline ? 'online' : 'offline');
    }
    
    if (this.isOnline) {
      console.log('[ElectricClient.forceSync] Connection verified, performing sync');
      return this.syncTodos();
    } else {
      console.log('[ElectricClient.forceSync] Not connected, cannot sync');
      return Promise.resolve([]); // Return empty array instead of rejecting
    }
  }

  // Clean up
  public dispose(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
