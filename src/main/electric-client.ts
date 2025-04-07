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
        
        // Only mark as offline for network-related errors, not for HTTP status errors
        // HTTP errors (4xx, 5xx) could be specific to the endpoint, not connectivity
        console.error(`[ElectricClient.syncTodos] HTTP ${response.status} error, but not changing connection status`);
        
        // Throw an error specific to the HTTP status for the caller to handle
        throw new Error(`HTTP ${response.status}: ${errorText}`);
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
    } catch (error: any) {
      // Catch network errors or JSON parsing errors
      console.error('[ElectricClient.syncTodos] Failed to sync todos:', error);
      
      // Check if it's a genuine network-related error vs HTTP status error
      const isNetworkError = (error instanceof TypeError && error.message.includes('fetch')) ||
                             (error.name === 'TimeoutError') || 
                             (error.name === 'AbortError');
      
      // Don't mark as offline for 400 errors or HTTP status errors (likely just endpoint issues)
      if (isNetworkError && !(error.message && error.message.includes('400'))) {
        console.log('[ElectricClient.syncTodos] Network error detected, marking as offline.');
        this.isOnline = false; // Mark as offline on network error
        this.notifyStatusChange('offline');
      } else {
        // Don't change online status for HTTP status errors or other errors
        console.error('[ElectricClient.syncTodos] Non-network error during fetch:', error);
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
    let controlMessagesSkipped = 0;
    let dataEntriesProcessed = 0;
    let invalidEntriesSkipped = 0;
    
    // Add defensive check for non-array input
    if (!Array.isArray(entries)) {
      console.warn('[ElectricClient.processShapeLogEntries] Received non-array input:', entries);
      return [];
    }
    
    console.log('[ElectricClient.processShapeLogEntries] Raw shape entries received:', 
      JSON.stringify(entries).substring(0, 1000) + (entries.length > 1000 ? '...(truncated)' : ''));
    
    try {
      for (const entry of entries) {
        // Skip control messages
        if (entry.headers && entry.headers.control) {
          controlMessagesSkipped++;
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
          dataEntriesProcessed++;
        } else {
          invalidEntriesSkipped++;
          console.warn('[ElectricClient.processShapeLogEntries] Skipping invalid entry:', 
            JSON.stringify(entry).substring(0, 500));
        }
      }
      
      console.log(`[ElectricClient.processShapeLogEntries] Processing summary: ${dataEntriesProcessed} data entries processed, ${controlMessagesSkipped} control messages skipped, ${invalidEntriesSkipped} invalid entries skipped`);
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

  // Set connection status from external check
  public setConnectionStatus(isOnline: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = isOnline;
    
    if (wasOnline !== this.isOnline) {
      console.log(`[ElectricClient.setConnectionStatus] Connection status changed: ${wasOnline ? 'online' : 'offline'} → ${this.isOnline ? 'online' : 'offline'}`);
      this.notifyStatusChange(this.isOnline ? 'online' : 'offline');
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
