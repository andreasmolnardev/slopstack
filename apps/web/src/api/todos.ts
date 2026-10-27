import { createTodo, deleteTodo, listTodos, updateTodo } from './generated';
import { createClient } from './generated/client';
import type { Todo, TodoWrite } from './generated/types.gen';
import { pb } from './pocketbase';

const baseUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
const todoClient = createClient({
  baseUrl,
  auth: () => pb.authStore.token,
});

export async function getTodos(): Promise<Todo[]> {
  const { data } = await listTodos({ client: todoClient, throwOnError: true });
  return data ?? [];
}

export async function createTodoRecord(input: TodoWrite): Promise<Todo> {
  const { data } = await createTodo({
    client: todoClient,
    body: input,
    throwOnError: true,
  });
  return data;
}

export async function updateTodoRecord(id: string, input: TodoWrite): Promise<Todo> {
  const { data } = await updateTodo({
    client: todoClient,
    path: { id },
    body: input,
    throwOnError: true,
  });
  return data;
}

export async function deleteTodoRecord(id: string): Promise<void> {
  await deleteTodo({
    client: todoClient,
    path: { id },
    throwOnError: true,
  });
}
