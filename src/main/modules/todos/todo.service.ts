/**
 * Todo service
 * Contains the business logic for todos
 */
import * as crypto from 'crypto';
import { DatabaseError } from '../../error/app.error';
import { getLogger } from '../../logging';
import { sqliteService } from '../../database';
import { syncCoordinator } from '../../sync';
import { supabaseService } from '../../sync/supabase';
import { offlineStorageService } from '../../sync/offline';
import { TodoModel } from './todo.model';
import { Todo } from '../../../@types/todo';

const logger = getLogger('TodoService');

/**
 * Todo service class
 */
export class TodoService {
  /**
   * Get all todos
   * @returns Array of todos
   */
  public async getAllTodos(): Promise<Todo[]> {
    try {
      logger.info('Getting all todos');
      
      // Try to sync first if online
      if (syncCoordinator.getStatus() === 'online') {
        try {
          await syncCoordinator.syncWithSupabase();
        } catch (error) {
          logger.error('Error syncing before getting todos', error);
          // Continue with local data even if sync fails
        }
      }
      
      // Get todos from database
      const todos = sqliteService.queryAll<Todo>(
        'SELECT * FROM todos ORDER BY created_at DESC'
      );
      
      // Convert to Todo model instances
      return todos.map(todo => TodoModel.fromDbModel(todo));
    } catch (error) {
      logger.error('Error getting all todos', error);
      return [];
    }
  }
  
  /**
   * Get a todo by ID
   * @param id Todo ID
   * @returns Todo or undefined if not found
   */
  public getTodoById(id: string): Todo | undefined {
    try {
      logger.info(`Getting todo by ID: ${id}`);
      
      const todo = sqliteService.queryOne<Todo>(
        'SELECT * FROM todos WHERE id = ?',
        [id]
      );
      
      return todo ? TodoModel.fromDbModel(todo) : undefined;
    } catch (error) {
      logger.error(`Error getting todo by ID: ${id}`, error);
      return undefined;
    }
  }
  
  /**
   * Add a new todo
   * @param title Todo title
   * @returns The newly created todo or null if failed
   */
  public async addTodo(title: string): Promise<Todo | null> {
    try {
      // Generate UUID for the new todo
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      
      // Create a new todo with the Model
      const newTodo = TodoModel.create(id, title, false, created_at);
      
      logger.info(`Adding new todo: ${id} - "${title}"`);
      
      // Insert into local database
      sqliteService.execute(
        'INSERT INTO todos (id, title, completed, created_at) VALUES (?, ?, ?, ?)',
        [
          newTodo.id,
          newTodo.title,
          TodoModel.toDbModel(newTodo).completed,
          newTodo.created_at
        ]
      );
      
      // Check if we're online by testing Supabase connection
      let isOnline = false;
      try {
        isOnline = await supabaseService.checkConnection();
      } catch (err) {
        logger.error('Supabase connection check error', err);
        isOnline = false;
      }
      
      // Sync with Supabase if online
      if (isOnline) {
        try {
          logger.info(`Adding todo directly to Supabase: ${id}`);
          const success = await supabaseService.createTodo(newTodo);
          
          if (!success) {
            logger.error(`Supabase insert failed for todo: ${id}`);
            
            // Store as pending operation
            offlineStorageService.addPendingOperation('create', id, newTodo);
          } else {
            logger.debug(`Todo added to Supabase successfully: ${id}`);
          }
        } catch (syncError) {
          logger.error(`Error adding to Supabase: ${id}`, syncError);
          
          // Store as pending operation
          offlineStorageService.addPendingOperation('create', id, newTodo);
        }
      } else {
        logger.info('Offline, storing pending operation');
        // Store as pending operation if offline
        offlineStorageService.addPendingOperation('create', id, newTodo);
      }
      
      return newTodo;
    } catch (error) {
      logger.error('Error adding todo', error);
      return null;
    }
  }
  
  /**
   * Toggle a todo's completion status
   * @param id Todo ID
   * @param completed New completion status
   * @returns True if successful, false otherwise
   */
  public async toggleTodo(id: string, completed: boolean): Promise<boolean> {
    try {
      logger.info(`Toggling todo ${id} to ${completed ? 'completed' : 'incomplete'}`);
      
      // Update local database
      const result = sqliteService.execute(
        'UPDATE todos SET completed = ? WHERE id = ?',
        [completed ? 1 : 0, id]
      );
      
      if (result.changes === 0) {
        logger.warn(`Todo with id ${id} not found for toggle`);
        return false;
      }
      
      // Get the updated todo
      const todo = this.getTodoById(id);
      
      // Check if the todo was actually found
      if (!todo) {
        logger.error(`Todo with id ${id} not found after update`);
        return false;
      }
      
      // Check if we're online by testing Supabase connection
      let isOnline = false;
      try {
        isOnline = await supabaseService.checkConnection();
      } catch (err) {
        logger.error('Supabase connection check error', err);
        isOnline = false;
      }
      
      // Sync with Supabase if online
      if (isOnline) {
        try {
          logger.info(`Updating todo ${id} directly in Supabase: completed=${completed}`);
          const success = await supabaseService.updateTodo(id, { completed });
          
          if (!success) {
            logger.error(`Supabase update failed for todo: ${id}`);
            
            // Store as pending operation
            offlineStorageService.addPendingOperation('update', id, todo);
          } else {
            logger.debug(`Todo ${id} updated in Supabase successfully`);
          }
        } catch (syncError) {
          logger.error(`Error updating in Supabase: ${id}`, syncError);
          
          // Store as pending operation
          offlineStorageService.addPendingOperation('update', id, todo);
        }
      } else {
        logger.info('Offline, storing pending operation');
        // Store as pending operation if offline
        offlineStorageService.addPendingOperation('update', id, todo);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error toggling todo ${id}`, error);
      return false;
    }
  }
  
  /**
   * Delete a todo
   * @param id Todo ID
   * @returns True if successful, false otherwise
   */
  public async deleteTodo(id: string): Promise<boolean> {
    try {
      logger.info(`Deleting todo: ${id}`);
      
      // Delete from local database
      const result = sqliteService.execute(
        'DELETE FROM todos WHERE id = ?',
        [id]
      );
      
      if (result.changes === 0) {
        logger.warn(`Todo with id ${id} not found for deletion`);
        return false;
      }
      
      // Check if we're online by testing Supabase connection
      let isOnline = false;
      try {
        isOnline = await supabaseService.checkConnection();
      } catch (err) {
        logger.error('Supabase connection check error', err);
        isOnline = false;
      }
      
      // Sync with Supabase if online
      if (isOnline) {
        try {
          logger.info(`Deleting todo ${id} directly from Supabase`);
          const success = await supabaseService.deleteTodo(id);
          
          if (!success) {
            logger.error(`Supabase delete failed for todo: ${id}`);
            
            // Store as pending operation
            offlineStorageService.addPendingOperation('delete', id);
          } else {
            logger.debug(`Todo ${id} deleted from Supabase successfully`);
          }
        } catch (syncError) {
          logger.error(`Error deleting from Supabase: ${id}`, syncError);
          
          // Store as pending operation
          offlineStorageService.addPendingOperation('delete', id);
        }
      } else {
        logger.info('Offline, storing pending operation');
        // Store as pending operation if offline
        offlineStorageService.addPendingOperation('delete', id);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error deleting todo ${id}`, error);
      return false;
    }
  }
}

// Export as singleton
export const todoService = new TodoService();
export default todoService;