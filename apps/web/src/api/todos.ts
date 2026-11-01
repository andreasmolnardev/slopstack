import { createTodo, deleteTodo, getTodo, listTodos, updateTodo } from './generated';
import { createClient } from './generated/client';
import type { Todo, TodoWrite } from './generated/types.gen';
import { pb } from './pocketbase';
import { createResourceClient } from '@slopstack/core';
import { todoResource } from '@/resources/todos';

const baseUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
const todoClient = createClient({
  baseUrl,
  auth: () => pb.authStore.token,
});

const todoResources = createResourceClient<Todo, TodoWrite, TodoWrite>(todoResource, {
  async list() {
    const { data } = await listTodos({ client: todoClient, throwOnError: true });
    const items = data ?? [];
    return { items, total: items.length };
  },
  async get(id) {
    const { data } = await getTodo({ client: todoClient, path: { id }, throwOnError: true });
    return data;
  },
  async create(input) {
    const { data } = await createTodo({ client: todoClient, body: input, throwOnError: true });
    return data;
  },
  async update(id, input) {
    const { data } = await updateTodo({ client: todoClient, path: { id }, body: input, throwOnError: true });
    return data;
  },
  async delete(id) {
    await deleteTodo({ client: todoClient, path: { id }, throwOnError: true });
  },
});

export async function getTodos(): Promise<Todo[]> {
  return [...(await todoResources.list()).items];
}

export async function createTodoRecord(input: TodoWrite): Promise<Todo> {
  return todoResources.create(input);
}

export async function updateTodoRecord(id: string, input: TodoWrite): Promise<Todo> {
  return todoResources.update(id, input);
}

export async function deleteTodoRecord(id: string): Promise<void> {
  await todoResources.delete(id);
}
