/**
 * Connection monitor
 * Responsible for monitoring connectivity to Electric and Supabase
 */
import { EventEmitter } from 'events';
import configService from '../../config';
import { getLogger } from '../../logging';
import { electricClient } from '../electric';
import { supabaseService } from '../supabase';
import { NetworkError } from '../../error/app.error';

const logger = getLogger('ConnectionMonitor');

/**
 * Connection status type
 */
export type ConnectionStatus = 'online' | 'offline' | 'syncing';

// Re-export for consistent importing
export type { ConnectionStatus };

/**
 * Connection monitor events
 */
export interface ConnectionMonitorEvents {
  'status-change': (status: ConnectionStatus, previousStatus: ConnectionStatus) => void;
  'electric-status-change': (isOnline: boolean) => void;
  'supabase-status-change': (isOnline: boolean) => void;
}

/**
 * Connection monitor service
 * Monitors connectivity to Electric and Supabase
 */
export class ConnectionMonitor extends EventEmitter {
  private checkInterval: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private maxConsecutiveFailures: number;
  private currentStatus: ConnectionStatus = 'offline';
  private consecutiveElectricFailures: number = 0;
  private consecutiveSupabaseFailures: number = 0;
  private electricOnline: boolean = false;
  private supabaseOnline: boolean = false;
  
  constructor() {
    super();
    
    // Configure from config service
    this.intervalMs = configService.getOrDefault('CONNECTION_CHECK_INTERVAL', 10000, 'number');
    this.maxConsecutiveFailures = configService.getOrDefault('MAX_CONSECUTIVE_FAILURES', 3, 'number');
    
    logger.info(`Initializing connection monitor with interval: ${this.intervalMs}ms, max failures: ${this.maxConsecutiveFailures}`);
  }
  
  /**
   * Start monitoring connections
   */
  public start(): void {
    if (this.checkInterval) {
      this.stop();
    }
    
    logger.info('Starting connection monitoring');
    
    // Perform initial connection check right away
    this.checkConnections();
    
    // Set up periodic checks
    this.checkInterval = setInterval(() => {
      this.checkConnections();
    }, this.intervalMs);
  }
  
  /**
   * Stop monitoring connections
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped connection monitoring');
    }
  }
  
  /**
   * Check connectivity to Electric and Supabase
   */
  public async checkConnections(): Promise<void> {
    logger.debug('Checking connection status');
    
    // Check both services in parallel
    const [isElectricOnline, isSupabaseOnline] = await Promise.all([
      this.checkElectricConnection(),
      this.checkSupabaseConnection()
    ]);
    
    // Update internal state
    const wasElectricOnline = this.electricOnline;
    const wasSupabaseOnline = this.supabaseOnline;
    
    this.electricOnline = isElectricOnline;
    this.supabaseOnline = isSupabaseOnline;
    
    // Track consecutive failures
    if (!isElectricOnline) {
      this.consecutiveElectricFailures++;
      logger.debug(`Electric connection check failed (${this.consecutiveElectricFailures}/${this.maxConsecutiveFailures})`);
    } else {
      this.consecutiveElectricFailures = 0;
    }
    
    if (!isSupabaseOnline) {
      this.consecutiveSupabaseFailures++;
      logger.debug(`Supabase connection check failed (${this.consecutiveSupabaseFailures}/${this.maxConsecutiveFailures})`);
    } else {
      this.consecutiveSupabaseFailures = 0;
    }
    
    // Emit service-specific events if status changed
    if (wasElectricOnline !== this.electricOnline) {
      logger.info(`Electric status changed: ${wasElectricOnline ? 'online' : 'offline'} → ${this.electricOnline ? 'online' : 'offline'}`);
      this.emit('electric-status-change', this.electricOnline);
      
      // Update Electric client's internal state
      electricClient.setConnectionStatus(this.electricOnline);
    }
    
    if (wasSupabaseOnline !== this.supabaseOnline) {
      logger.info(`Supabase status changed: ${wasSupabaseOnline ? 'online' : 'offline'} → ${this.supabaseOnline ? 'online' : 'offline'}`);
      this.emit('supabase-status-change', this.supabaseOnline);
    }
    
    // Determine overall app status
    const previousStatus = this.currentStatus;
    const isAppOffline = (this.consecutiveElectricFailures >= this.maxConsecutiveFailures && 
                         this.consecutiveSupabaseFailures >= this.maxConsecutiveFailures);
    
    // App is online if either service is available after enough reliable checks
    this.currentStatus = isAppOffline ? 'offline' : 'online';
    
    // Emit status change event if status changed
    if (previousStatus !== this.currentStatus) {
      logger.info(`Overall connection status changed: ${previousStatus} → ${this.currentStatus}`);
      this.emit('status-change', this.currentStatus, previousStatus);
    }
  }
  
  /**
   * Check Electric connection
   * @returns True if connected, false otherwise
   */
  private async checkElectricConnection(): Promise<boolean> {
    try {
      return await electricClient.checkConnection();
    } catch (error) {
      logger.error('Error checking Electric connection', error);
      return false;
    }
  }
  
  /**
   * Check Supabase connection
   * @returns True if connected, false otherwise
   */
  private async checkSupabaseConnection(): Promise<boolean> {
    try {
      return await supabaseService.checkConnection();
    } catch (error) {
      logger.error('Error checking Supabase connection', error);
      return false;
    }
  }
  
  /**
   * Force an immediate connection check
   * @returns The current connection status
   */
  public async forceCheck(): Promise<ConnectionStatus> {
    await this.checkConnections();
    return this.currentStatus;
  }
  
  /**
   * Get the current connection status
   * @returns The current connection status
   */
  public getStatus(): ConnectionStatus {
    return this.currentStatus;
  }
  
  /**
   * Check if Electric is online
   * @returns True if Electric is online, false otherwise
   */
  public isElectricOnline(): boolean {
    return this.electricOnline;
  }
  
  /**
   * Check if Supabase is online
   * @returns True if Supabase is online, false otherwise
   */
  public isSupabaseOnline(): boolean {
    return this.supabaseOnline;
  }
  
  /**
   * Set the status to syncing
   * Used by the sync coordinator to indicate sync in progress
   */
  public setSyncing(): void {
    const previousStatus = this.currentStatus;
    this.currentStatus = 'syncing';
    
    if (previousStatus !== this.currentStatus) {
      logger.info(`Status manually set to: ${this.currentStatus}`);
      this.emit('status-change', this.currentStatus, previousStatus);
    }
  }
  
  /**
   * Update status after syncing
   * Used by the sync coordinator to update status after sync completed
   */
  public syncCompleted(): void {
    // Recheck connectivity to determine current status
    this.checkConnections();
  }
  
  /**
   * Override TypeScript's default on method for better type checking
   */
  public on<E extends keyof ConnectionMonitorEvents>(
    event: E, 
    listener: ConnectionMonitorEvents[E]
  ): this {
    return super.on(event, listener as any);
  }
  
  /**
   * Override TypeScript's default emit method for better type checking
   */
  public emit<E extends keyof ConnectionMonitorEvents>(
    event: E, 
    ...args: Parameters<ConnectionMonitorEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Export as singleton
export const connectionMonitor = new ConnectionMonitor();
export default connectionMonitor;