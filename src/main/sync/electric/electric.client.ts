/**
 * ElectricSQL client for syncing with Supabase
 * Responsible for making HTTP requests to ElectricSQL and handling responses
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import configService from '../../config';
import { getLogger } from '../../logging';
import { ElectricError, NetworkError } from '../../error/app.error';

const logger = getLogger('ElectricClient');

/**
 * Sync state interface for persistent storage
 */
interface SyncState {
  syncOffset: string;
  syncHandle: string;
  lastSync: string;
}

/**
 * ElectricSQL client class
 */
export class ElectricClient {
  private electricUrl: string;
  private isOnline: boolean = false;
  private localStoragePath: string;
  private syncOffset: string = '-1';
  private syncHandle: string = '';
  
  constructor() {
    this.electricUrl = configService.getElectricUrl();
    this.localStoragePath = configService.getOrDefault(
      'ELECTRIC_STORAGE_PATH', 
      path.join(app.getPath('userData'), 'electric-sync.json')
    );
    
    logger.info(`Initializing ElectricSQL client with URL: ${this.electricUrl}`);
    this.loadSyncState();
  }
  
  /**
   * Initialize the sync client
   */
  public async initialize(): Promise<void> {
    try {
      // Check if we're online
      this.isOnline = await this.checkConnection();
      logger.info(`ElectricSQL client initialized, online status: ${this.isOnline}`);
      return Promise.resolve();
    } catch (error) {
      logger.error('Failed to initialize ElectricSQL client', error);
      this.isOnline = false;
      return Promise.reject(new ElectricError(`Failed to initialize: ${(error as Error).message}`));
    }
  }
  
  /**
   * Check if we can connect to the Electric service
   */
  public async checkConnection(): Promise<boolean> {
    try {
      logger.debug('Checking ElectricSQL connection');
      
      // Try the root endpoint first (according to ElectricSQL HTTP API)
      const response = await fetch(`${this.electricUrl}/`, {
        signal: AbortSignal.timeout(3000),
        headers: {
          'Accept': 'application/json'
        }
      });
      
      // Consider any successful response (2xx) as online
      const isOnline = response.status >= 200 && response.status < 300;
      logger.debug(`ElectricSQL connection check result: ${isOnline ? 'online' : 'offline'}`);
      return isOnline;
    } catch (error) {
      logger.warn('Electric service not reachable', error);
      return false;
    }
  }
  
  /**
   * Get the raw shape log entries from ElectricSQL
   * @returns The shape log entries as received from ElectricSQL
   */
  public async fetchShapeLog(): Promise<any[]> {
    if (!this.isOnline) {
      logger.info('Skipping fetchShapeLog, not online');
      return [];
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
    
    logger.info(`Requesting shape data with offset: ${this.syncOffset}`);
    if (this.syncHandle) {
      logger.debug(`Using handle: ${this.syncHandle}`);
    }
    
    try {
      const response = await fetch(url, options);
      logger.debug(`Shape response status: ${response.status}`);
      
      // Log all headers for debugging
      const headers: { [key: string]: string } = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      logger.verbose('Response headers:', headers);
      
      // Check if response is successful (status 200-299)
      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (textError) {
          errorText = 'Could not read error response';
        }
        
        logger.error(`Shape request failed with status ${response.status}: ${errorText}`);
        
        // If we get a 400 error, throw specific error
        if (response.status === 400) {
          throw new ElectricError(`400 Bad Request: ${errorText}`);
        }
        
        // Throw an error specific to the HTTP status for the caller to handle
        throw new ElectricError(`HTTP ${response.status}: ${errorText}`);
      }
      
      // Extract sync metadata from headers (only if response is OK)
      const newOffset = response.headers.get('electric-offset');
      if (newOffset) {
        logger.debug(`Updated sync offset: ${newOffset}`);
        this.syncOffset = newOffset;
      } else {
        logger.warn('No electric-offset header in response');
      }
      
      const newHandle = response.headers.get('electric-handle');
      if (newHandle) {
        logger.debug(`Updated sync handle: ${newHandle}`);
        this.syncHandle = newHandle;
      } else {
        logger.warn('No electric-handle header in response');
      }
      
      // Save sync state after successful parsing
      this.saveSyncState();
      
      // Process the shape log entries (only if response is OK)
      let entries = [];
      try {
        entries = await response.json();
        logger.info(`Received ${entries?.length ?? 0} shape log entries`);
      } catch (jsonError) {
        logger.error('Failed to parse JSON response', jsonError);
        return []; // Return empty array on parse error
      }
      
      return entries;
    } catch (error: any) {
      // Catch network errors or JSON parsing errors
      logger.error('Failed to fetch shape log', error);
      
      // Check if it's a genuine network-related error vs HTTP status error
      const isNetworkError = (error instanceof TypeError && error.message.includes('fetch')) ||
                             (error.name === 'TimeoutError') || 
                             (error.name === 'AbortError');
      
      // Don't mark as offline for 400 errors or HTTP status errors (likely just endpoint issues)
      if (isNetworkError && !(error.message && error.message.includes('400'))) {
        logger.info('Network error detected, marking as offline');
        this.isOnline = false;
      } else {
        // Don't change online status for HTTP status errors or other errors
        logger.error('Non-network error during fetch', error);
      }
      
      if (isNetworkError) {
        throw new NetworkError(`Network error fetching shape log: ${error.message}`);
      } else {
        throw new ElectricError(`Error fetching shape log: ${error.message}`);
      }
    }
  }
  
  /**
   * Reset the sync offset to -1 (for initial sync or to recover from errors)
   */
  public resetSyncOffset(): void {
    logger.info('Resetting sync offset to -1');
    this.syncOffset = '-1';
    this.syncHandle = '';
    this.saveSyncState();
  }
  
  /**
   * Save sync state to local storage
   */
  private saveSyncState(): void {
    const state: SyncState = {
      syncOffset: this.syncOffset,
      syncHandle: this.syncHandle,
      lastSync: new Date().toISOString()
    };
    
    try {
      // Create directory if it doesn't exist
      const dirPath = path.dirname(this.localStoragePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      fs.writeFileSync(this.localStoragePath, JSON.stringify(state, null, 2));
      logger.debug('Saved sync state to storage');
    } catch (error) {
      logger.error('Failed to save sync state', error);
    }
  }
  
  /**
   * Load sync state from local storage
   */
  private loadSyncState(): void {
    try {
      if (fs.existsSync(this.localStoragePath)) {
        const data = fs.readFileSync(this.localStoragePath, 'utf8');
        const state = JSON.parse(data) as SyncState;
        
        // Check if the stored state has valid values
        if (state.syncOffset && state.syncOffset !== 'undefined' && state.syncOffset !== 'null') {
          logger.info(`Loaded sync offset: ${state.syncOffset}`);
          this.syncOffset = state.syncOffset;
        } else {
          logger.info('No valid offset found, using default -1');
          this.syncOffset = '-1';
        }
        
        if (state.syncHandle && state.syncHandle !== 'undefined' && state.syncHandle !== 'null') {
          logger.info(`Loaded sync handle: ${state.syncHandle}`);
          this.syncHandle = state.syncHandle;
        } else {
          logger.info('No valid handle found, using empty string');
          this.syncHandle = '';
        }
        
        // Log last sync time if available
        if (state.lastSync) {
          const lastSyncTime = new Date(state.lastSync);
          const now = new Date();
          const diffMinutes = Math.floor((now.getTime() - lastSyncTime.getTime()) / (1000 * 60));
          logger.info(`Last sync was ${diffMinutes} minutes ago`);
        }
      } else {
        logger.info('No sync state file found, using defaults');
        this.syncOffset = '-1';
        this.syncHandle = '';
      }
    } catch (error) {
      logger.warn('Failed to load sync state', error);
      this.syncOffset = '-1';
      this.syncHandle = '';
    }
  }
  
  /**
   * Set connection status from external check
   */
  public setConnectionStatus(isOnline: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = isOnline;
    
    if (wasOnline !== this.isOnline) {
      logger.info(`Connection status changed: ${wasOnline ? 'online' : 'offline'} → ${this.isOnline ? 'online' : 'offline'}`);
    }
  }
  
  /**
   * Get online status
   */
  public isConnected(): boolean {
    return this.isOnline;
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    logger.info('Disposing ElectricSQL client');
  }
}