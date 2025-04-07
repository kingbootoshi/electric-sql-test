// Define TypeScript interface for Todo items
interface Todo {
  id: string;
  title: string;
  completed: number; // SQLite stores booleans as integers (0 or 1)
  created_at: string;
}

// Define TypeScript interface for sync status
type SyncStatus = 'offline' | 'online' | 'syncing';

// Access the exposed API from the preload script
declare global {
  interface Window {
    electronAPI: {
      getTodos: () => Promise<Todo[]>;
      addTodo: (title: string) => Promise<Todo | null>;
      toggleTodo: (id: string, completed: boolean) => Promise<boolean>;
      deleteTodo: (id: string) => Promise<boolean>;
      getSyncStatus: () => Promise<SyncStatus>;
      forceSync: () => Promise<any>;
      onSyncStatusChange: (callback: (status: SyncStatus) => void) => () => void;
    }
  }
}

// DOM Elements
const newTodoInput = document.getElementById('new-todo') as HTMLInputElement;
const addButton = document.getElementById('add-button') as HTMLButtonElement;
const todoList = document.getElementById('todo-list') as HTMLUListElement;
const syncStatusElement = document.getElementById('sync-status') as HTMLDivElement;
const syncButton = document.getElementById('sync-button') as HTMLButtonElement;

// Current sync status
let currentSyncStatus: SyncStatus = 'offline';

// Load todos when the app starts
document.addEventListener('DOMContentLoaded', () => {
  loadTodos();
  setupSyncStatus();
});

// Add event listeners
addButton.addEventListener('click', addTodo);
newTodoInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addTodo();
  }
});

if (syncButton) {
  syncButton.addEventListener('click', forceSync);
}

// Setup sync status display and listener
async function setupSyncStatus() {
  // Get initial sync status
  currentSyncStatus = await window.electronAPI.getSyncStatus();
  updateSyncStatusDisplay(currentSyncStatus);
  
  // Listen for sync status changes
  window.electronAPI.onSyncStatusChange((status) => {
    currentSyncStatus = status;
    updateSyncStatusDisplay(status);
  });
}

// Update sync status display
function updateSyncStatusDisplay(status: SyncStatus) {
  if (!syncStatusElement) return;
  
  syncStatusElement.className = `sync-status ${status}`;
  
  switch (status) {
    case 'online':
      syncStatusElement.textContent = 'Online - In Sync';
      break;
    case 'offline':
      syncStatusElement.textContent = 'Offline';
      break;
    case 'syncing':
      syncStatusElement.textContent = 'Syncing...';
      break;
  }
}

// Force sync with Supabase
async function forceSync() {
  if (currentSyncStatus === 'syncing') return;
  
  try {
    updateSyncStatusDisplay('syncing');
    await window.electronAPI.forceSync();
    await loadTodos(); // Reload todos after sync
  } catch (error) {
    console.error('Failed to force sync:', error);
  }
}

// Load todos from the database
async function loadTodos() {
  try {
    const todos = await window.electronAPI.getTodos();
    renderTodos(todos);
  } catch (error) {
    console.error('Failed to load todos:', error);
  }
}

// Add a new todo
async function addTodo() {
  const title = newTodoInput.value.trim();
  if (!title) return;
  
  try {
    const newTodo = await window.electronAPI.addTodo(title);
    if (newTodo) {
      newTodoInput.value = '';
      await loadTodos(); // Reload all todos to get the updated list
    }
  } catch (error) {
    console.error('Failed to add todo:', error);
  }
}

// Toggle todo completion status
async function toggleTodo(id: string, completed: boolean) {
  try {
    const success = await window.electronAPI.toggleTodo(id, completed);
    if (success) {
      await loadTodos(); // Reload all todos to get the updated list
    }
  } catch (error) {
    console.error('Failed to toggle todo:', error);
  }
}

// Delete a todo
async function deleteTodo(id: string) {
  try {
    const success = await window.electronAPI.deleteTodo(id);
    if (success) {
      await loadTodos(); // Reload all todos to get the updated list
    }
  } catch (error) {
    console.error('Failed to delete todo:', error);
  }
}

// Render todos to the DOM
function renderTodos(todos: Todo[]) {
  todoList.innerHTML = '';
  
  todos.forEach(todo => {
    const li = document.createElement('li');
    li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-checkbox';
    checkbox.checked = Boolean(todo.completed);
    checkbox.addEventListener('change', () => toggleTodo(todo.id, checkbox.checked));
    
    const span = document.createElement('span');
    span.className = 'todo-text';
    span.textContent = todo.title;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
    
    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(deleteBtn);
    
    todoList.appendChild(li);
  });
}
