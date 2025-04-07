/**
 * Supabase client for direct interaction with Supabase
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import configService from '../../config';
import { getLogger } from '../../logging';
import { SupabaseError, NetworkError } from '../../error/app.error';
import { Todo } from '../../../@types/todo';

const logger = getLogger('SupabaseClient');

export class SupabaseService {
  private supabase: SupabaseClient;
  
  constructor() {
    // Get Supabase configuration
    const supabaseUrl = configService.getSupabaseUrl();
    const supabaseKey = configService.getSupabaseKey();
    
    // Validate configuration
    if (!supabaseUrl) {
      logger.error('Supabase URL not configured');
      throw new SupabaseError('Supabase URL not configured');
    }
    
    if (!supabaseKey) {
      logger.error('Supabase key not configured');
      throw new SupabaseError('Supabase key not configured');
    }
    
    // Initialize Supabase client
    this.supabase = createClient(supabaseUrl, supabaseKey);
    logger.info('Supabase client initialized');
  }
  
  /**
   * Check connection to Supabase
   * @returns True if connected, false otherwise
   */
  public async checkConnection(): Promise<boolean> {
    try {
      logger.debug('Checking Supabase connection');
      
      // Use a lightweight query to check connection
      const { error } = await this.supabase.from('todos')
        .select('id', { count: 'exact', head: true });
      
      const isConnected = !error;
      logger.debug(`Supabase connection check result: ${isConnected ? 'connected' : 'disconnected'}`);
      
      if (error) {
        logger.warn('Supabase connection check failed', error);
      }
      
      return isConnected;
    } catch (error) {
      logger.error('Error checking Supabase connection', error);
      return false;
    }
  }
  
  /**
   * Create a new todo in Supabase
   * @param todo The todo to create
   * @returns True if successful, false otherwise
   */
  public async createTodo(todo: Todo): Promise<boolean> {
    try {
      logger.info(`Creating todo in Supabase: ${todo.id}`);
      
      const { error } = await this.supabase.from('todos').insert({
        id: todo.id,
        title: todo.title,
        completed: typeof todo.completed === 'boolean' ? todo.completed : Boolean(todo.completed),
        created_at: todo.created_at
      });
      
      if (error) {
        logger.error(`Failed to create todo in Supabase: ${todo.id}`, error);
        return false;
      }
      
      logger.debug(`Todo created successfully in Supabase: ${todo.id}`);
      return true;
    } catch (error) {
      logger.error(`Error creating todo in Supabase: ${todo.id}`, error);
      
      // Determine if it's a network error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError(`Network error creating todo: ${error.message}`);
      } else {
        throw new SupabaseError(`Error creating todo: ${(error as Error).message}`);
      }
    }
  }
  
  /**
   * Update an existing todo in Supabase
   * @param id The ID of the todo to update
   * @param data The data to update
   * @returns True if successful, false otherwise
   */
  public async updateTodo(id: string, data: Partial<Todo>): Promise<boolean> {
    try {
      logger.info(`Updating todo in Supabase: ${id}`);
      
      // Convert completed to boolean if it's a number
      const updateData: Record<string, any> = { ...data };
      if (updateData.completed !== undefined) {
        updateData.completed = typeof updateData.completed === 'boolean' 
          ? updateData.completed 
          : Boolean(updateData.completed);
      }
      
      // Remove id from update data if present
      delete updateData.id;
      
      const { error } = await this.supabase.from('todos')
        .update(updateData)
        .eq('id', id);
      
      if (error) {
        logger.error(`Failed to update todo in Supabase: ${id}`, error);
        return false;
      }
      
      logger.debug(`Todo updated successfully in Supabase: ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error updating todo in Supabase: ${id}`, error);
      
      // Determine if it's a network error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError(`Network error updating todo: ${error.message}`);
      } else {
        throw new SupabaseError(`Error updating todo: ${(error as Error).message}`);
      }
    }
  }
  
  /**
   * Delete a todo from Supabase
   * @param id The ID of the todo to delete
   * @returns True if successful, false otherwise
   */
  public async deleteTodo(id: string): Promise<boolean> {
    try {
      logger.info(`Deleting todo from Supabase: ${id}`);
      
      const { error } = await this.supabase.from('todos')
        .delete()
        .eq('id', id);
      
      if (error) {
        logger.error(`Failed to delete todo from Supabase: ${id}`, error);
        return false;
      }
      
      logger.debug(`Todo deleted successfully from Supabase: ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting todo from Supabase: ${id}`, error);
      
      // Determine if it's a network error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError(`Network error deleting todo: ${error.message}`);
      } else {
        throw new SupabaseError(`Error deleting todo: ${(error as Error).message}`);
      }
    }
  }
  
  /**
   * Get the Supabase client instance
   * @returns The Supabase client
   */
  public getClient(): SupabaseClient {
    return this.supabase;
  }
}

// Export as singleton
export const supabaseService = new SupabaseService();
export default supabaseService;