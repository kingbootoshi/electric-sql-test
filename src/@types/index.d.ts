/**
 * Global type definitions
 */
import { Todo } from './todo';

declare global {
  interface Window {
    electronAPI: {
      // Todo operations
      getTodos: () => Promise<Todo[]>;
      addTodo: (title: string) => Promise<Todo | null>;
      toggleTodo: (id: string, completed: boolean) => Promise<boolean>;
      deleteTodo: (id: string) => Promise<boolean>;
      
      // Sync operations
      getSyncStatus: () => Promise<ConnectionStatus>;
      forceSync: () => Promise<any>;
      
      // Event listeners
      onSyncStatusChange: (callback: (status: ConnectionStatus) => void) => () => void;
      onTodosUpdated: (callback: () => void) => () => void;
      onAppError: (callback: (error: AppError) => void) => () => void;
    }
  }
}

// Connection status type
export type ConnectionStatus = 'offline' | 'online' | 'syncing';

// App error type
export interface AppError {
  name: string;
  message: string;
  code?: string;
}