/**
 * Todo model
 * Defines the data structure for a Todo item
 */
import { Todo } from '../../../@types/todo';

/**
 * Todo model with methods for validation and conversion
 */
export class TodoModel {
  /**
   * Create a new Todo object
   * @param id UUID for the todo
   * @param title Title of the todo
   * @param completed Whether the todo is completed
   * @param created_at Creation timestamp
   * @returns A new Todo object
   */
  public static create(
    id: string, 
    title: string, 
    completed: boolean | number = false, 
    created_at: string = new Date().toISOString()
  ): Todo {
    return {
      id,
      title,
      completed: typeof completed === 'boolean' ? completed : Boolean(completed),
      created_at
    };
  }
  
  /**
   * Normalize a Todo object to ensure consistent types
   * @param todo Todo object to normalize
   * @returns Normalized Todo object
   */
  public static normalize(todo: Todo): Todo {
    return {
      id: todo.id,
      title: todo.title || '',
      completed: typeof todo.completed === 'boolean' ? todo.completed : Boolean(todo.completed),
      created_at: todo.created_at || new Date().toISOString()
    };
  }
  
  /**
   * Convert a Todo object to its database representation
   * @param todo Todo object to convert
   * @returns Object with properties ready for database storage
   */
  public static toDbModel(todo: Todo): any {
    return {
      id: todo.id,
      title: todo.title,
      completed: typeof todo.completed === 'boolean' ? (todo.completed ? 1 : 0) : todo.completed,
      created_at: todo.created_at
    };
  }
  
  /**
   * Convert a database record to a Todo object
   * @param record Database record
   * @returns Todo object
   */
  public static fromDbModel(record: any): Todo {
    return {
      id: record.id,
      title: record.title,
      completed: record.completed === 1 || record.completed === true,
      created_at: record.created_at
    };
  }
  
  /**
   * Validate a Todo object
   * @param todo Todo object to validate
   * @returns True if valid, false otherwise
   */
  public static validate(todo: any): boolean {
    return (
      todo &&
      typeof todo.id === 'string' && todo.id.length > 0 &&
      typeof todo.title === 'string' &&
      (typeof todo.completed === 'boolean' || typeof todo.completed === 'number') &&
      (typeof todo.created_at === 'string' || todo.created_at instanceof Date)
    );
  }
}