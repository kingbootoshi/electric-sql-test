/**
 * Todo module index file
 */
import { TodoModel } from './todo.model';
import { todoService } from './todo.service';
import { registerTodoIpcHandlers, unregisterTodoIpcHandlers } from './todo.ipc';

export {
  TodoModel,
  todoService,
  registerTodoIpcHandlers,
  unregisterTodoIpcHandlers
};

// Export a function to initialize the todo module
export function initializeTodoModule(): void {
  registerTodoIpcHandlers();
}

export default {
  model: TodoModel,
  service: todoService,
  initialize: initializeTodoModule
};