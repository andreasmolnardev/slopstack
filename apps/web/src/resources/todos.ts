import type { Todo, TodoWrite } from '@/api/generated/types.gen';
import { defineResource } from '@/lib/slopstack';

export const todoResource = defineResource<Todo, TodoWrite, TodoWrite>({
  id: 'todos',
  label: 'Todo',
  labelPlural: 'Todos',
  description: 'Tasks owned by the signed-in user.',
  source: {
    kind: 'endpoint',
    list: '/api/todos',
    get: '/api/todos/{id}',
    create: '/api/todos',
    update: '/api/todos/{id}',
    delete: '/api/todos/{id}',
  },
  fields: [
    { name: 'title', label: 'Title', kind: 'text', required: true, maxLength: 240 },
    { name: 'description', label: 'Description', kind: 'text', multiline: true, rows: 3, maxLength: 4000 },
    {
      name: 'priority',
      label: 'Priority',
      kind: 'select',
      defaultValue: 'Medium',
      options: [
        { label: 'High', value: 'High' },
        { label: 'Medium', value: 'Medium' },
        { label: 'Low', value: 'Low' },
      ],
    },
    { name: 'completed', label: 'Completed', kind: 'boolean', defaultValue: false },
    { name: 'due_date', label: 'Due date', kind: 'date' },
  ],
  operations: { list: true, get: true, create: true, update: true, delete: true },
  permissions: {
    list: { authenticated: true },
    get: { authenticated: true },
    create: { authenticated: true },
    update: { authenticated: true },
    delete: { authenticated: true },
  },
  identify: (record) => record.id,
  query: {
    searchFields: ['title', 'description'],
    defaultSort: 'due_date,created,id',
    pageSize: 25,
  },
});
