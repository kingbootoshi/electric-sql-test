/**
 * Todo IPC handlers
 * Defines and registers IPC handlers for todo operations
 */
import { ipcMain } from 'electron';
import { getLogger } from '../../logging';
import { todoService } from './todo.service';

const logger = getLogger('TodoIPC');

/**
 * Register all IPC handlers for todos
 */
export function registerTodoIpcHandlers(): void {
  logger.info('Registering todo IPC handlers');
  
  // Get all todos
  ipcMain.handle('todos:getAll', async () => {
    logger.debug('IPC: todos:getAll called');
    return todoService.getAllTodos();
  });
  
  // Add a new todo
  ipcMain.handle('todos:add', async (_, title: string) => {
    logger.debug(`IPC: todos:add called with title: "${title}"`);
    return todoService.addTodo(title);
  });
  
  // Toggle todo completion
  ipcMain.handle('todos:toggle', async (_, id: string, completed: boolean) => {
    logger.debug(`IPC: todos:toggle called for ${id} to ${completed}`);
    return todoService.toggleTodo(id, completed);
  });
  
  // Delete a todo
  ipcMain.handle('todos:delete', async (_, id: string) => {
    logger.debug(`IPC: todos:delete called for ${id}`);
    return todoService.deleteTodo(id);
  });
}

/**
 * Unregister all IPC handlers for todos
 */
export function unregisterTodoIpcHandlers(): void {
  logger.info('Unregistering todo IPC handlers');
  
  ipcMain.removeHandler('todos:getAll');
  ipcMain.removeHandler('todos:add');
  ipcMain.removeHandler('todos:toggle');
  ipcMain.removeHandler('todos:delete');
}