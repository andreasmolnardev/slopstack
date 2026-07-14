import { FormEvent, useState } from 'react';
import { pb } from './api/pocketbase';

type Todo = { id: string; title: string; completed: boolean; dueDate?: string };

const initialTodos: Todo[] = [
  { id: 'welcome', title: 'Replace this todo with your application', completed: false },
];

export function App() {
  const [todos, setTodos] = useState(initialTodos);
  const [title, setTitle] = useState('');
  const user = pb.authStore.record;

  function addTodo(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    setTodos((current) => [...current, { id: crypto.randomUUID(), title: value, completed: false }]);
    setTitle('');
  }

  return (
    <main className="shell">
      <aside><strong>Slopstack</strong><nav>Dashboard<br />Todos<br />Admin</nav></aside>
      <section>
        <header><div><p className="eyebrow">EXAMPLE MODULE</p><h1>My todos</h1></div><span>{user?.email ?? 'Guest mode'}</span></header>
        <form onSubmit={addTodo}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs doing?" /><button>Add todo</button></form>
        <div className="card">
          {todos.map((todo) => <label className="todo" key={todo.id}><input type="checkbox" checked={todo.completed} onChange={() => setTodos((current) => current.map((item) => item.id === todo.id ? { ...item, completed: !item.completed } : item))} /><span className={todo.completed ? 'complete' : ''}>{todo.title}</span><button type="button" onClick={() => setTodos((current) => current.filter((item) => item.id !== todo.id))}>Remove</button></label>)}
        </div>
      </section>
    </main>
  );
}
