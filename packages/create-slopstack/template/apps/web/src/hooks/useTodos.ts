import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTodo, deleteTodo, listTodos, updateTodo } from '@/api/generated';
import type { Todo, TodoCreateInputBody, TodoUpdateInputBody } from '@/api/generated';
import '@/api/client';

export const todosQueryKey = ['todos'] as const;

export function useTodos(enabled: boolean) {
  return useQuery({
    queryKey: todosQueryKey,
    queryFn: async () => {
      const { data } = await listTodos({ throwOnError: true });
      return data ?? [];
    },
    enabled,
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TodoCreateInputBody) => createTodo({ body, throwOnError: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todosQueryKey }),
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TodoUpdateInputBody }) =>
      updateTodo({ path: { id }, body, throwOnError: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todosQueryKey }),
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Todo['id']) => deleteTodo({ path: { id }, throwOnError: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todosQueryKey }),
  });
}
