/**
 * @file src/@types/todo.ts
 * @description Defines the structure for a Todo item.
 */

/**
 * Represents a single Todo item.
 */
export interface Todo {
  /** Unique identifier for the todo. */
  id: string;
  /** The text content of the todo. */
  title: string;
  /** 
   * Indicates whether the todo is completed.
   * Can be boolean (from app logic) or number (from SQLite where 0=false, 1=true).
   */
  completed: number | boolean;
  /** ISO 8601 timestamp string indicating when the todo was created. */
  created_at: string;
} 