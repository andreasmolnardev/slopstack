import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bookmark,
  Blocks,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Cloud,
  Code2,
  Clock3,
  Copy,
  CreditCard,
  Database,
  Download,
  Eye,
  FileText,
  Filter,
  Flag,
  Folder,
  Github,
  Globe,
  Heart,
  Home,
  Image,
  Info,
  KeyRound,
  Link,
  LayoutDashboard,
  ListTodo,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Moon,
  Package,
  Pencil,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  Shapes,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Sun,
  Tag,
  Upload,
  User,
  UserCog,
  UserPlus,
  Users,
  Video,
  WandSparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useTheme } from 'next-themes';
import { pb } from './api/pocketbase';
import type { Todo } from './api/generated';
import { useCreateTodo, useDeleteTodo, useTodos, useUpdateTodo } from './hooks/useTodos';

type Priority = 'High' | 'Medium' | 'Low';
type View = 'overview' | 'tasks' | 'schedule' | 'analytics' | 'components' | 'icons' | 'profile';
type AuthMode = 'login' | 'register' | 'forgot-password' | 'admin-login';
type AdminSection = 'users' | 'sso';
type Route =
  | { kind: 'app'; view: View }
  | { kind: 'admin'; section: AdminSection }
  | { kind: 'auth'; mode: AuthMode }
  | { kind: 'not-found' };
type Task = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'components', label: 'Components', icon: Blocks },
  { id: 'icons', label: 'Icons', icon: Shapes },
];

const componentNames = [
  'Accordion',
  'Alert',
  'Alert dialog',
  'Aspect ratio',
  'Attachment',
  'Avatar',
  'Badge',
  'Breadcrumb',
  'Bubble',
  'Button',
  'Button group',
  'Calendar',
  'Card',
  'Carousel',
  'Chart',
  'Checkbox',
  'Collapsible',
  'Combobox',
  'Command',
  'Context menu',
  'Direction',
  'Dialog',
  'Drawer',
  'Dropdown menu',
  'Empty',
  'Field',
  'Hover card',
  'Input',
  'Input group',
  'Input OTP',
  'Item',
  'Kbd',
  'Label',
  'Marker',
  'Menubar',
  'Message',
  'Message scroller',
  'Navigation menu',
  'Native select',
  'Pagination',
  'Popover',
  'Progress',
  'Radio group',
  'Resizable',
  'Scroll area',
  'Select',
  'Separator',
  'Sheet',
  'Sidebar',
  'Skeleton',
  'Slider',
  'Sonner',
  'Spinner',
  'Switch',
  'Table',
  'Tabs',
  'Textarea',
  'Toggle',
  'Toggle group',
  'Tooltip',
] as const;

export function normalizePath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function routeForPath(pathname: string): Route {
  switch (normalizePath(pathname)) {
    case '/app':
    case '/app/overview':
      return { kind: 'app', view: 'overview' };
    case '/app/tasks':
      return { kind: 'app', view: 'tasks' };
    case '/app/schedule':
      return { kind: 'app', view: 'schedule' };
    case '/app/analytics':
      return { kind: 'app', view: 'analytics' };
    case '/app/components':
      return { kind: 'app', view: 'components' };
    case '/app/icons':
      return { kind: 'app', view: 'icons' };
    case '/app/profile':
      return { kind: 'app', view: 'profile' };
    case '/admin':
    case '/admin/users':
      return { kind: 'admin', section: 'users' };
    case '/admin/sso':
      return { kind: 'admin', section: 'sso' };
    case '/auth/login':
      return { kind: 'auth', mode: 'login' };
    case '/auth/register':
      return { kind: 'auth', mode: 'register' };
    case '/auth/forgot-password':
      return { kind: 'auth', mode: 'forgot-password' };
    case '/auth/admin':
      return { kind: 'auth', mode: 'admin-login' };
    default:
      return { kind: 'not-found' };
  }
}

function useNavigation() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((path: string, replace = false) => {
    if (window.location.pathname === path) return;
    if (replace) {
      window.history.replaceState({}, '', path);
    } else {
      window.history.pushState({}, '', path);
    }
    setPathname(new URL(path, window.location.origin).pathname);
    window.scrollTo({ top: 0 });
  }, []);

  return { pathname, navigate };
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

type AuthIdentity = {
  display_name?: string;
  name?: string;
  email?: string;
  isAdmin?: boolean;
};

export function getUserName(user: unknown) {
  const identity = user && typeof user === 'object' ? (user as AuthIdentity) : undefined;
  const name = identity?.display_name?.trim() || identity?.name?.trim();
  if (name) return name;
  return identity?.email?.split('@')[0] || '';
}

export function getUserInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function formatDate(value: string) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(`${value}T12:00:00`),
  );
}

function taskFromTodo(todo: Todo): Task {
  return {
    id: todo.id,
    title: todo.title,
    dueDate: todo.due_date?.slice(0, 10) ?? '',
    completed: todo.completed,
  };
}

export function priorityClass(priority: Priority) {
  return priority === 'High'
    ? 'bg-rose-100 text-rose-700'
    : priority === 'Medium'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-sky-100 text-sky-700';
}

export function App() {
  const { pathname, navigate } = useNavigation();
  const route = routeForPath(pathname);
  const [, refreshAuth] = useState(0);
  const todosQuery = useTodos(pb.authStore.isValid);
  const createTodoMutation = useCreateTodo();
  const updateTodoMutation = useUpdateTodo();
  const deleteTodoMutation = useDeleteTodo();
  const tasks = useMemo(() => (todosQuery.data ?? []).map(taskFromTodo), [todosQuery.data]);
  const [taskFilter, setTaskFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const isAuthenticated = pb.authStore.isValid;
  const isSuperuser = pb.authStore.record?.collectionName === '_superusers';
  const isAdmin = isSuperuser || pb.authStore.record?.isAdmin === true;

  useEffect(() => {
    return pb.authStore.onChange(() => refreshAuth((value) => value + 1));
  }, []);

  const completed = tasks.filter((task) => task.completed).length;
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesFilter =
          taskFilter === 'all' ||
          (taskFilter === 'active' && !task.completed) ||
          (taskFilter === 'completed' && task.completed);
        const query = search.trim().toLowerCase();
        return matchesFilter && (!query || task.title.toLowerCase().includes(query));
      }),
    [search, taskFilter, tasks],
  );

  function signOut() {
    pb.authStore.clear();
    navigate('/auth/login', true);
  }

  useEffect(() => {
    if (pathname === '/' || pathname === '/app') {
      navigate(isAuthenticated ? '/app/overview' : '/auth/login', true);
      return;
    }
    if (route.kind === 'app' && !isAuthenticated) {
      navigate(`/auth/login?redirect=${encodeURIComponent(pathname)}`, true);
      return;
    }
    if (route.kind === 'admin' && !isAuthenticated) {
      navigate(`/auth/admin?redirect=${encodeURIComponent(pathname)}`, true);
      return;
    }
    if (route.kind === 'auth' && isAuthenticated) {
      navigate(
        route.mode === 'admin-login' && isSuperuser ? '/admin/users' : '/app/overview',
        true,
      );
    }
  }, [isAdmin, isAuthenticated, isSuperuser, navigate, pathname, route]);

  if (pathname === '/' || pathname === '/app') return null;
  if (route.kind === 'auth') {
    return <AuthPage mode={route.mode} navigate={navigate} />;
  }
  if (route.kind === 'admin') {
    if (!isAuthenticated) return null;
    if (!isSuperuser) return <AdminAccessDenied navigate={navigate} onSignOut={signOut} />;
    return <AdminDashboard section={route.section} navigate={navigate} onSignOut={signOut} />;
  }
  if (route.kind === 'not-found') {
    return <NotFoundPage navigate={navigate} />;
  }
  if (!isAuthenticated) {
    return null;
  }

  if (todosQuery.isPending) {
    return <main className="p-8 text-sm text-muted-foreground">Loading your todos…</main>;
  }

  if (todosQuery.isError) {
    return (
      <main className="grid min-h-screen place-content-center gap-3 p-8 text-center">
        <h1 className="text-lg font-semibold">Could not load your todos</h1>
        <p role="alert" className="text-sm text-destructive">
          {todosQuery.error instanceof Error ? todosQuery.error.message : 'Please try again.'}
        </p>
        <Button onClick={() => void todosQuery.refetch()}>Retry</Button>
      </main>
    );
  }

  const view = route.view;
  const user = pb.authStore.record;
  const userName = getUserName(user);
  const userInitials = getUserInitials(userName);

  async function createTask(title: string, dueDate: string) {
    await createTodoMutation.mutateAsync({
      title,
      completed: false,
      ...(dueDate ? { due_date: dueDate } : {}),
    });
  }

  function toggleTask(id: string, completed: boolean) {
    updateTodoMutation.mutate({ id, body: { completed } });
  }

  function removeTask(id: string) {
    deleteTodoMutation.mutate(id);
  }

  function renderView() {
    if (view === 'tasks')
      return (
        <TasksView
          tasks={visibleTasks}
          onToggle={toggleTask}
          onDelete={removeTask}
          search={search}
          onSearch={setSearch}
          filter={taskFilter}
          onFilter={setTaskFilter}
          onAdd={() => setDialogOpen(true)}
        />
      );
    if (view === 'schedule') return <ScheduleView tasks={tasks} onToggle={toggleTask} />;
    if (view === 'analytics') return <AnalyticsView tasks={tasks} />;
    if (view === 'components') {
      return <ComponentsView userInitials={userInitials} userName={userName} />;
    }
    if (view === 'icons') return <IconsView />;
    if (view === 'profile') {
      return <SettingsDialog onClose={() => navigate('/app/overview')} />;
    }
    return (
      <>
        <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <Badge variant="secondary" className="mb-3 gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Reference module
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Good morning, {userName}
            </h1>
            <p className="mt-2 text-muted-foreground">
              A complete task example built on Slopstack primitives.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate('/app/analytics')}>
              <BarChart3 className="size-4" />
              View analytics
            </Button>
            <Button className="gap-2" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              Add task
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Open tasks"
            value={String(tasks.length - completed)}
            detail="Across 3 projects"
            icon={ListTodo}
            tone="blue"
          />
          <StatCard
            label="Completed"
            value={`${completed}/${tasks.length}`}
            detail="This week"
            icon={CheckCircle2}
            tone="green"
          />
          <StatCard
            label="Team members"
            value="12"
            detail="4 active today"
            icon={Users}
            tone="violet"
          />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <CardTitle>Tasks in this example</CardTitle>
                  <CardDescription>
                    This example reads and writes your PocketBase-backed todos.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                    <Input
                      className="w-full pl-9 sm:w-52"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search tasks"
                    />
                  </div>
                  <Button variant="outline" size="icon" aria-label="Filter tasks">
                    <SlidersHorizontal className="size-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs value={taskFilter} onValueChange={setTaskFilter} className="border-b px-3 pt-2">
                <TabsList>
                  <TabsTrigger value="all">
                    All <span className="ml-1 text-muted-foreground">{tasks.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="active">
                    Active{' '}
                    <span className="ml-1 text-muted-foreground">{tasks.length - completed}</span>
                  </TabsTrigger>
                  <TabsTrigger value="completed">
                    Completed <span className="ml-1 text-muted-foreground">{completed}</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="divide-y">
                {visibleTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={removeTask} />
                ))}
                {visibleTasks.length === 0 && (
                  <div className="p-5 text-center text-sm text-muted-foreground">
                    {tasks.length === 0
                      ? 'No todos yet. Add one to get started.'
                      : 'No todos match current filter.'}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Progress</CardTitle>
                    <CardDescription>Example project delivery</CardDescription>
                  </div>
                  <Badge variant="outline">68%</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <Progress value={68} className="h-2" />
                <div className="mt-4 flex justify-between text-xs text-muted-foreground">
                  <span>17 of 25 tasks</span>
                  <span>Due Aug 30</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Upcoming</CardTitle>
                <CardDescription>Your next scheduled work</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {['Team sync', 'Design review', 'Launch retro'].map((item, index) => (
                  <div className="flex items-center gap-3" key={item}>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item}</p>
                      <p className="text-xs text-muted-foreground">
                        {index === 0
                          ? 'Today, 2:00 PM'
                          : index === 1
                            ? 'Tomorrow, 10:30 AM'
                            : 'Friday, 4:00 PM'}
                      </p>
                    </div>
                    <ChevronDown className="size-4 -rotate-90 text-muted-foreground" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <CreateTodoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={createTask}
        isPending={createTodoMutation.isPending}
      />
      <div className="flex h-full w-full">
        <aside className="hidden h-full w-64 shrink-0 flex-col border-r bg-card px-2 py-3 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Check className="size-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Slopstack</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Reference app
              </p>
            </div>
          </div>
          <div className="mt-6 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </div>
          <nav className="mt-3 grid gap-1" aria-label="Workspace navigation">
            {navItems.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={view === id ? 'secondary' : 'ghost'}
                className="justify-start gap-3 font-medium"
                onClick={() => navigate(`/app/${id}`)}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            ))}{' '}
          </nav>
          <div className="mt-6 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Manage
          </div>
          <nav className="mt-3 grid gap-1">
            <Button
              variant={view === 'profile' ? 'secondary' : 'ghost'}
              className="justify-start gap-3"
              onClick={() => navigate('/app/profile')}
            >
              <Settings2 className="size-4" />
              Settings
            </Button>
            <Button
              variant="ghost"
              className="justify-start gap-3"
              onClick={() => window.open('/docs', '_blank')}
            >
              <FileText className="size-4" />
              API docs
              <ArrowUpRight className="ml-auto size-3" />
            </Button>
            {isSuperuser && (
              <Button
                variant="ghost"
                className="justify-start gap-3"
                onClick={() => navigate('/admin/users')}
              >
                <UserCog className="size-4" />
                Admin console
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                className="justify-start gap-3"
                onClick={() => navigate('/app/profile')}
              >
                <ShieldCheck className="size-4" />
                Admin settings
              </Button>
            )}
          </nav>
          <div className="mt-auto pt-8">
            <SidebarTools />
            <Separator className="mb-5" />
            <div className="flex items-center gap-3 px-1">
              <Avatar>
                <AvatarFallback className="bg-orange-100 text-orange-700">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{userName}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
                <LogOut className="size-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${
              view === 'profile'
                ? 'px-2 py-3 sm:px-3 lg:px-4 lg:py-3'
                : 'px-3 py-4 sm:px-5 lg:px-5 lg:py-5'
            }`}
          >
            <div className="w-full">
              {(createTodoMutation.isError ||
                updateTodoMutation.isError ||
                deleteTodoMutation.isError) && (
                <p
                  role="alert"
                  className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {String(
                    createTodoMutation.error ??
                      updateTodoMutation.error ??
                      deleteTodoMutation.error,
                  )}
                </p>
              )}
              {renderView()}
            </div>
          </div>
          <nav className="flex shrink-0 border-t bg-card px-2 py-1 lg:hidden">
            {navItems.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={view === id ? 'secondary' : 'ghost'}
                className="flex-1 flex-col gap-1 py-1 text-[10px]"
                onClick={() => navigate(`/app/${id}`)}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}

function CreateTodoDialog({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string, dueDate: string) => Promise<void>;
  isPending: boolean;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    setError('');
    try {
      await onCreate(normalizedTitle, dueDate);
      setTitle('');
      setDueDate('');
      onOpenChange(false);
    } catch {
      setError('Could not create the todo. Please try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add new todo</DialogTitle>
          <DialogDescription>This todo will be saved to your account.</DialogDescription>
        </DialogHeader>
        <form id="new-task-form" onSubmit={submit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="task-title">Task name</Label>
            <Input
              id="task-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Plan a release"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-due">Due date</Label>
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-task-form" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthPage({
  mode,
  navigate,
  redirectPath,
}: {
  mode: AuthMode;
  navigate: (path: string, replace?: boolean) => void;
  redirectPath?: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [ssoLoading, setSsoLoading] = useState(false);
  const queryRedirect = new URLSearchParams(window.location.search).get('redirect');
  const isRegister = mode === 'register';
  const isForgotPassword = mode === 'forgot-password';
  const isAdminLogin = mode === 'admin-login';
  const fallbackDestination = isAdminLogin ? '/admin/users' : '/app/overview';
  const requestedDestination = redirectPath ?? queryRedirect;
  const destination =
    requestedDestination?.startsWith('/app/') || requestedDestination?.startsWith('/admin/')
      ? requestedDestination
      : fallbackDestination;
  const collection = isAdminLogin ? '_superusers' : 'users';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');

    try {
      if (isForgotPassword) {
        await pb.collection('users').requestPasswordReset(email.trim());
        setMessage('If this email exists, password reset instructions are on their way.');
        return;
      }

      if (isRegister) {
        await pb.collection('users').create({
          display_name: name.trim(),
          email: email.trim(),
          password,
          passwordConfirm: password,
        });
      }

      await pb.collection(collection).authWithPassword(email.trim(), password);
      navigate(destination, true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : 'Unable to complete request.',
      );
    }
  }

  async function signInWithSso(provider: 'google' | 'github') {
    setError('');
    setSsoLoading(true);
    try {
      await pb.collection('users').authWithOAuth2({ provider });
      navigate(destination, true);
    } catch (ssoError) {
      setError(ssoError instanceof Error ? ssoError.message : 'Unable to sign in with SSO.');
    } finally {
      setSsoLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-3 py-5 text-foreground">
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-slate-950 text-white">
            <Check className="size-5" />
          </div>
          <div>
            <p className="font-semibold tracking-tight">Slopstack</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Reference app
            </p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              {isAdminLogin
                ? 'Admin sign in'
                : isForgotPassword
                  ? 'Reset your password'
                  : isRegister
                    ? 'Create your account'
                    : 'Welcome back'}
            </CardTitle>
            <CardDescription>
              {isAdminLogin
                ? 'Sign in with a PocketBase superuser account.'
                : isForgotPassword
                  ? 'Enter your email and we will send reset instructions.'
                  : isRegister
                    ? 'Create an account to access your workspace.'
                    : 'Sign in to continue to your workspace.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submit}>
              {isRegister && (
                <div className="grid gap-2">
                  <Label htmlFor="auth-name">Name</Label>
                  <Input
                    id="auth-name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                    required
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              {!isForgotPassword && (
                <div className="grid gap-2">
                  <Label htmlFor="auth-password">Password</Label>
                  <Input
                    id="auth-password"
                    type="password"
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              {message && <p className="text-sm text-emerald-600">{message}</p>}
              <Button type="submit">
                {isForgotPassword ? 'Send reset link' : isRegister ? 'Create account' : 'Sign in'}
              </Button>
              {!isAdminLogin && !isRegister && !isForgotPassword && (
                <>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Separator className="flex-1" />
                    <span>or continue with SSO</span>
                    <Separator className="flex-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={ssoLoading}
                      onClick={() => void signInWithSso('google')}
                    >
                      Google
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={ssoLoading}
                      onClick={() => void signInWithSso('github')}
                    >
                      GitHub
                    </Button>
                  </div>
                </>
              )}
            </form>
            <div className="mt-6 grid gap-2 text-center text-sm text-muted-foreground">
              {!isAdminLogin && !isRegister && !isForgotPassword && (
                <Button
                  variant="link"
                  type="button"
                  onClick={() => navigate('/auth/forgot-password')}
                >
                  Forgot password?
                </Button>
              )}
              {isAdminLogin ? (
                <Button variant="link" type="button" onClick={() => navigate('/auth/login')}>
                  Back to workspace sign in
                </Button>
              ) : isForgotPassword ? (
                <Button variant="link" type="button" onClick={() => navigate('/auth/login')}>
                  Back to sign in
                </Button>
              ) : isRegister ? (
                <p>
                  Already have an account?{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    type="button"
                    onClick={() => navigate('/auth/login')}
                  >
                    Sign in
                  </Button>
                </p>
              ) : (
                <p>
                  Need an account?{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    type="button"
                    onClick={() => navigate('/auth/register')}
                  >
                    Register
                  </Button>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

type ManagedUser = {
  id: string;
  email: string;
  name?: string;
  display_name?: string;
  verified: boolean;
  disabled: boolean;
  created: string;
};

type SsoProvider = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authURL?: string;
  tokenURL?: string;
  userInfoURL?: string;
};

const ssoProviderDefaults: SsoProvider[] = [
  {
    id: 'google',
    label: 'Google',
    description: 'Google Workspace and consumer accounts.',
    enabled: false,
    clientId: '',
    clientSecret: '',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'GitHub organization and team accounts.',
    enabled: false,
    clientId: '',
    clientSecret: '',
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    description: 'Microsoft Entra ID and Microsoft accounts.',
    enabled: false,
    clientId: '',
    clientSecret: '',
  },
  {
    id: 'oidc2',
    label: 'OpenID Connect',
    description: 'Any provider that supports OIDC discovery.',
    enabled: false,
    clientId: '',
    clientSecret: '',
    authURL: '',
    tokenURL: '',
    userInfoURL: '',
  },
];

function AdminAccessDenied({
  navigate,
  onSignOut,
}: {
  navigate: (path: string, replace?: boolean) => void;
  onSignOut: () => void;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-3 text-center text-foreground">
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>
      <div className="max-w-md">
        <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Admin access required</h1>
        <p className="mt-2 text-muted-foreground">
          This area requires a PocketBase superuser session.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/app/overview')}>
            Back to workspace
          </Button>
          <Button
            onClick={() => {
              onSignOut();
              navigate('/auth/admin', true);
            }}
          >
            Use admin sign in
          </Button>
        </div>
      </div>
    </main>
  );
}

function AdminDashboard({
  section,
  navigate,
  onSignOut,
}: {
  section: AdminSection;
  navigate: (path: string, replace?: boolean) => void;
  onSignOut: () => void;
}) {
  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full w-full">
        <aside className="hidden h-full w-64 shrink-0 flex-col border-r bg-card px-2 py-3 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white">
              <UserCog className="size-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Admin console</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Slopstack
              </p>
            </div>
          </div>
          <p className="mt-6 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Administration
          </p>
          <nav className="mt-3 grid gap-1" aria-label="Admin navigation">
            <Button
              variant={section === 'users' ? 'secondary' : 'ghost'}
              className="justify-start gap-3"
              onClick={() => navigate('/admin/users')}
            >
              <Users className="size-4" />
              Users
            </Button>
            <Button
              variant={section === 'sso' ? 'secondary' : 'ghost'}
              className="justify-start gap-3"
              onClick={() => navigate('/admin/sso')}
            >
              <ShieldCheck className="size-4" />
              SSO & security
            </Button>
          </nav>
          <div className="mt-auto pt-8">
            <Separator className="mb-5" />
            <Button
              variant="ghost"
              className="w-full justify-start gap-3"
              onClick={() => navigate('/app/overview')}
            >
              <ArrowUpRight className="size-4 rotate-180" />
              Back to workspace
            </Button>
            <Button variant="ghost" className="mt-1 w-full justify-start gap-3" onClick={onSignOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/90 px-3 backdrop-blur sm:px-5">
            <div className="flex items-center gap-3 lg:hidden">
              <UserCog className="size-5" />
              <span className="font-semibold">Admin console</span>
            </div>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
              <span>Admin</span>
              <span>/</span>
              <span className="font-medium text-foreground">
                {section === 'users' ? 'Users' : 'SSO & security'}
              </span>
            </div>
            <Button variant="ghost" className="gap-2 px-2" onClick={onSignOut}>
              <ShieldCheck className="size-4 text-emerald-600" />
              <span className="text-sm">Superuser</span>
              <LogOut className="size-4 text-muted-foreground" />
            </Button>
            <ThemeToggle />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 lg:px-5 lg:py-5">
            <div className="w-full">
              {section === 'users' ? <AdminUsersView /> : <AdminSsoView />}
            </div>
          </div>
          <nav className="flex shrink-0 border-t bg-card px-2 py-1 lg:hidden">
            <Button
              variant={section === 'users' ? 'secondary' : 'ghost'}
              className="flex-1 gap-2"
              onClick={() => navigate('/admin/users')}
            >
              <Users className="size-4" />
              Users
            </Button>
            <Button
              variant={section === 'sso' ? 'secondary' : 'ghost'}
              className="flex-1 gap-2"
              onClick={() => navigate('/admin/sso')}
            >
              <ShieldCheck className="size-4" />
              SSO
            </Button>
          </nav>
        </div>
      </div>
    </main>
  );
}

function AdminUsersView() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      setUsers(await pb.collection('users').getFullList<ManagedUser>({ sort: '-created' }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    try {
      await pb.collection('users').create({
        display_name: newUser.name.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        passwordConfirm: newUser.password,
      });
      setNewUser({ name: '', email: '', password: '' });
      setDialogOpen(false);
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create user.');
    }
  }

  async function toggleDisabled(user: ManagedUser) {
    try {
      await pb.collection('users').update(user.id, { disabled: !user.disabled });
      await loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update user.');
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    try {
      await pb.collection('users').delete(user.id);
      await loadUsers();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete user.');
    }
  }

  const visibleUsers = users.filter((user) => {
    const query = search.trim().toLowerCase();
    return (
      !query ||
      `${user.email} ${user.name ?? ''} ${user.display_name ?? ''}`.toLowerCase().includes(query)
    );
  });

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Users"
        description="Manage workspace accounts, access, and invitations from one place."
        action={
          <Button className="gap-2" onClick={() => setDialogOpen(true)}>
            <UserPlus className="size-4" />
            Add user
          </Button>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total users"
          value={String(users.length)}
          detail="Workspace accounts"
          icon={Users}
          tone="blue"
        />
        <StatCard
          label="Verified"
          value={String(users.filter((user) => user.verified).length)}
          detail="Email verified"
          icon={ShieldCheck}
          tone="green"
        />
        <StatCard
          label="Disabled"
          value={String(users.filter((user) => user.disabled).length)}
          detail="Access paused"
          icon={UserCog}
          tone="violet"
        />
      </div>
      <Card>
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Workspace accounts</CardTitle>
              <CardDescription>Changes apply directly to PocketBase auth records.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <Input
                  className="w-full pl-9 sm:w-64"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search users"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh users"
                onClick={() => void loadUsers()}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && <p className="border-b px-3 py-2 text-sm text-destructive">{error}</p>}
          {loading ? (
            <div className="p-5 text-center text-sm text-muted-foreground">Loading users...</div>
          ) : visibleUsers.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">No users found.</div>
          ) : (
            <div className="divide-y">
              {visibleUsers.map((user) => (
                <div
                  className="flex flex-col gap-4 px-3 py-2 sm:flex-row sm:items-center"
                  key={user.id}
                >
                  <Avatar>
                    <AvatarFallback className="bg-violet-100 text-violet-700">
                      {(user.display_name ?? user.name ?? user.email).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.display_name ?? user.name ?? 'Unnamed user'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={user.verified ? 'secondary' : 'outline'}>
                      {user.verified ? 'Verified' : 'Unverified'}
                    </Badge>
                    <Badge variant={user.disabled ? 'destructive' : 'outline'}>
                      {user.disabled ? 'Disabled' : 'Active'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void toggleDisabled(user)}>
                      {user.disabled ? 'Enable' : 'Disable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${user.email}`}
                      onClick={() => void deleteUser(user)}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add workspace user</DialogTitle>
            <DialogDescription>
              Create an account and send credentials through your normal invite process.
            </DialogDescription>
          </DialogHeader>
          <form id="admin-new-user" className="grid gap-4 py-2" onSubmit={createUser}>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-name">Name</Label>
              <Input
                id="admin-user-name"
                value={newUser.name}
                onChange={(event) => setNewUser({ ...newUser, name: event.target.value })}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-email">Email</Label>
              <Input
                id="admin-user-email"
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-user-password">Temporary password</Label>
              <Input
                id="admin-user-password"
                type="password"
                minLength={8}
                value={newUser.password}
                onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
                required
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="admin-new-user">
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AdminSsoView() {
  const [enabled, setEnabled] = useState(false);
  const [providers, setProviders] = useState(ssoProviderDefaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadSettings() {
      try {
        const collection = (await pb.send('/api/collections/users', { method: 'GET' })) as {
          oauth2?: {
            enabled?: boolean;
            providers?: Array<{
              name: string;
              clientId?: string;
              authURL?: string;
              tokenURL?: string;
              userInfoURL?: string;
            }>;
          };
        };
        const oauth2 = collection.oauth2;
        setEnabled(Boolean(oauth2?.enabled));
        setProviders(
          ssoProviderDefaults.map((provider) => {
            const configured = oauth2?.providers?.find((item) => item.name === provider.id);
            return {
              ...provider,
              enabled: Boolean(configured),
              clientId: configured?.clientId ?? '',
              authURL: configured?.authURL ?? provider.authURL,
              tokenURL: configured?.tokenURL ?? provider.tokenURL,
              userInfoURL: configured?.userInfoURL ?? provider.userInfoURL,
            };
          }),
        );
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load SSO settings.');
      } finally {
        setLoading(false);
      }
    }
    void loadSettings();
  }, []);

  async function saveSettings() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await pb.send('/api/collections/users', {
        method: 'PATCH',
        body: {
          oauth2: {
            enabled,
            providers: providers
              .filter((provider) => provider.enabled)
              .map(({ id, clientId, clientSecret, authURL, tokenURL, userInfoURL }) => ({
                name: id,
                clientId,
                ...(clientSecret ? { clientSecret } : {}),
                ...(authURL ? { authURL } : {}),
                ...(tokenURL ? { tokenURL } : {}),
                ...(userInfoURL ? { userInfoURL } : {}),
              })),
          },
        },
      });
      setMessage('SSO settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save SSO settings.');
    } finally {
      setSaving(false);
    }
  }

  function updateProvider(id: string, update: Partial<SsoProvider>) {
    setProviders((current) =>
      current.map((provider) => (provider.id === id ? { ...provider, ...update } : provider)),
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="SSO & security"
        description="Configure PocketBase OAuth2 providers for workspace sign-in."
        action={
          <Button
            className="gap-2"
            onClick={() => void saveSettings()}
            disabled={saving || loading}
          >
            <Save className="size-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        }
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {message && <p className="mb-4 text-sm text-emerald-600">{message}</p>}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
          <CardDescription>
            Allow users to authenticate with a configured OAuth2 provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 border-t pt-3">
          <div>
            <p className="font-medium">Enable SSO</p>
            <p className="text-sm text-muted-foreground">
              Provider buttons become available after saving.
            </p>
          </div>
          <Button variant={enabled ? 'default' : 'outline'} onClick={() => setEnabled(!enabled)}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {providers.map((provider) => (
          <Card key={provider.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{provider.label}</CardTitle>
                  <CardDescription>{provider.description}</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant={provider.enabled ? 'default' : 'outline'}
                  onClick={() => updateProvider(provider.id, { enabled: !provider.enabled })}
                >
                  {provider.enabled ? 'On' : 'Off'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`${provider.id}-client-id`}>Client ID</Label>
                <Input
                  id={`${provider.id}-client-id`}
                  value={provider.clientId}
                  onChange={(event) =>
                    updateProvider(provider.id, { clientId: event.target.value })
                  }
                  placeholder="OAuth client ID"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${provider.id}-client-secret`}>Client secret</Label>
                <Input
                  id={`${provider.id}-client-secret`}
                  type="password"
                  value={provider.clientSecret}
                  onChange={(event) =>
                    updateProvider(provider.id, { clientSecret: event.target.value })
                  }
                  placeholder="OAuth client secret"
                />
              </div>
              {provider.id === 'oidc2' && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor={`${provider.id}-auth-url`}>Authorization URL</Label>
                    <Input
                      id={`${provider.id}-auth-url`}
                      type="url"
                      value={provider.authURL ?? ''}
                      onChange={(event) =>
                        updateProvider(provider.id, { authURL: event.target.value })
                      }
                      placeholder="https://idp.example.com/authorize"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`${provider.id}-token-url`}>Token URL</Label>
                    <Input
                      id={`${provider.id}-token-url`}
                      type="url"
                      value={provider.tokenURL ?? ''}
                      onChange={(event) =>
                        updateProvider(provider.id, { tokenURL: event.target.value })
                      }
                      placeholder="https://idp.example.com/token"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`${provider.id}-userinfo-url`}>User info URL</Label>
                    <Input
                      id={`${provider.id}-userinfo-url`}
                      type="url"
                      value={provider.userInfoURL ?? ''}
                      onChange={(event) =>
                        updateProvider(provider.id, { userInfoURL: event.target.value })
                      }
                      placeholder="https://idp.example.com/userinfo"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Callback URL</CardTitle>
          <CardDescription>Register this URL with each identity provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block rounded-lg bg-muted p-2 text-sm">
            {window.location.origin}/api/oauth2-redirect
          </code>
        </CardContent>
      </Card>
    </>
  );
}

function NotFoundPage({ navigate }: { navigate: (path: string, replace?: boolean) => void }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-3 text-center text-foreground">
      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-muted-foreground">This route does not exist.</p>
        <Button className="mt-6" onClick={() => navigate('/app/overview')}>
          Go to workspace
        </Button>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof ListTodo;
  tone: 'blue' | 'green' | 'violet';
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-3">
        <div className={`flex size-11 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TasksView({
  tasks,
  onToggle,
  onDelete,
  search,
  onSearch,
  filter,
  onFilter,
  onAdd,
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  filter: string;
  onFilter: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="Example module"
        title="Tasks"
        description="Create and manage todos saved to your account."
        action={
          <Button className="gap-2" onClick={onAdd}>
            <Plus className="size-4" />
            New task
          </Button>
        }
      />
      <Card>
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <CardTitle>All tasks</CardTitle>
              <CardDescription>Todos are loaded from the authenticated API.</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="w-full pl-9 sm:w-64"
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                placeholder="Search tasks"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs value={filter} onValueChange={onFilter} className="border-b px-3 pt-2">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="divide-y">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />
            ))}
            {tasks.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {tasks.length === 0
                  ? 'No todos yet. Add one to get started.'
                  : 'No todos match current filter.'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex items-start gap-4 px-3 py-2 transition-colors hover:bg-muted/20">
      <Checkbox
        id={task.id}
        checked={task.completed}
        onCheckedChange={(checked) => onToggle(task.id, checked === true)}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={task.id}
          className={`block cursor-pointer text-sm font-medium ${task.completed ? 'text-muted-foreground line-through' : ''}`}
        >
          {task.title}
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            {formatDate(task.dueDate)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`Delete ${task.title}`}
          onClick={() => onDelete(task.id)}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="More task actions">
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function ScheduleView({
  tasks,
  onToggle,
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="Planning"
        title="Schedule"
        description="See how the example module turns tasks into a working day."
        action={
          <Button className="gap-2">
            <Plus className="size-4" />
            Schedule item
          </Button>
        }
      />
      <Card className="mb-6">
        <CardContent className="grid gap-4 p-3 sm:grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
            <div
              className={`rounded-xl p-2 text-center ${index === 3 ? 'bg-slate-950 text-white' : 'bg-muted/40'}`}
              key={day}
            >
              <p className="text-xs opacity-70">{day}</p>
              <p className="mt-2 text-lg font-semibold">{23 + index}</p>
              <div
                className={`mx-auto mt-2 size-1.5 rounded-full ${index === 3 ? 'bg-white' : 'bg-slate-500'}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {tasks.slice(0, 4).map((task, index) => (
          <Card key={task.id}>
            <CardContent className="flex items-center gap-4 p-3">
              <div className="w-20 text-xs font-medium text-muted-foreground">
                {['09:00 AM', '10:30 AM', '01:00 PM', '03:30 PM'][index]}
              </div>
              <div className="h-10 w-1 rounded-full bg-slate-950" />
              <div className="flex-1">
                <p className="font-medium">{task.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatDate(task.dueDate)}</p>
              </div>
              <Checkbox
                checked={task.completed}
                onCheckedChange={(checked) => onToggle(task.id, checked === true)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function AnalyticsView({ tasks }: { tasks: Task[] }) {
  const completed = tasks.filter((task) => task.completed).length;
  return (
    <>
      <PageHeading
        eyebrow="Workspace insights"
        title="Analytics"
        description="A reference dashboard for adding reporting to your module."
        action={
          <Button variant="outline" className="gap-2">
            <ArrowUpRight className="size-4" />
            Share report
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Delivery overview</CardTitle>
            <CardDescription>Task completion across this example</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-56 items-end gap-3 border-b pb-0">
              {[38, 55, 44, 72, 64, 86, 68, 92, 78, 84, 68, 96].map((height, index) => (
                <div className="flex flex-1 flex-col justify-end gap-2" key={index}>
                  <div className="rounded-t-md bg-slate-900/90" style={{ height: `${height}%` }} />
                  <span className="text-center text-[10px] text-muted-foreground">{index + 1}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-6 text-sm">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-slate-900" />
                Completed tasks
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2 rounded-full bg-slate-200" />
                Target
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Team performance</CardTitle>
            <CardDescription>Project health at a glance</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Metric
              label="Completion rate"
              value={`${Math.round((completed / Math.max(tasks.length, 1)) * 100)}%`}
              progress={(completed / Math.max(tasks.length, 1)) * 100}
            />
            <Metric label="On-time delivery" value="95%" progress={95} />
            <Metric label="Team capacity" value="78%" progress={78} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

type IconCategory = 'Arrows' | 'Communication' | 'Files' | 'Interface' | 'People' | 'Media';
type IconEntry = {
  name: string;
  icon: LucideIcon;
  category: IconCategory;
  keywords: string;
};

const iconEntries: IconEntry[] = [
  { name: 'Activity', icon: Activity, category: 'Interface', keywords: 'pulse health analytics' },
  { name: 'Archive', icon: Archive, category: 'Files', keywords: 'box storage save' },
  { name: 'ArrowDown', icon: ArrowDown, category: 'Arrows', keywords: 'down direction move' },
  { name: 'ArrowLeft', icon: ArrowLeft, category: 'Arrows', keywords: 'back previous direction' },
  { name: 'ArrowRight', icon: ArrowRight, category: 'Arrows', keywords: 'forward next direction' },
  { name: 'ArrowUp', icon: ArrowUp, category: 'Arrows', keywords: 'up direction move' },
  { name: 'Bell', icon: Bell, category: 'Communication', keywords: 'notification alert' },
  { name: 'Bookmark', icon: Bookmark, category: 'Interface', keywords: 'save favorite read later' },
  { name: 'Calendar', icon: Calendar, category: 'Interface', keywords: 'date schedule event' },
  { name: 'Camera', icon: Camera, category: 'Media', keywords: 'photo capture' },
  {
    name: 'CheckCircle2',
    icon: CheckCircle2,
    category: 'Interface',
    keywords: 'done success complete',
  },
  { name: 'Clipboard', icon: Clipboard, category: 'Files', keywords: 'copy tasks notes' },
  { name: 'Cloud', icon: Cloud, category: 'Files', keywords: 'upload storage online' },
  { name: 'Code2', icon: Code2, category: 'Interface', keywords: 'developer brackets programming' },
  { name: 'Copy', icon: Copy, category: 'Interface', keywords: 'duplicate clone paste' },
  {
    name: 'CreditCard',
    icon: CreditCard,
    category: 'Interface',
    keywords: 'payment billing finance',
  },
  { name: 'Database', icon: Database, category: 'Files', keywords: 'data server storage' },
  { name: 'Download', icon: Download, category: 'Arrows', keywords: 'save export' },
  { name: 'Eye', icon: Eye, category: 'Interface', keywords: 'view visible preview' },
  { name: 'FileText', icon: FileText, category: 'Files', keywords: 'document page note' },
  { name: 'Filter', icon: Filter, category: 'Interface', keywords: 'sort refine funnel' },
  { name: 'Flag', icon: Flag, category: 'Interface', keywords: 'marker report priority' },
  { name: 'Folder', icon: Folder, category: 'Files', keywords: 'directory project' },
  { name: 'Github', icon: Github, category: 'Communication', keywords: 'github repository social' },
  { name: 'Globe', icon: Globe, category: 'Interface', keywords: 'world web language' },
  { name: 'Heart', icon: Heart, category: 'Interface', keywords: 'love favorite like' },
  { name: 'Home', icon: Home, category: 'Interface', keywords: 'house dashboard' },
  { name: 'Image', icon: Image, category: 'Media', keywords: 'picture photo asset' },
  { name: 'Info', icon: Info, category: 'Interface', keywords: 'help details about' },
  { name: 'KeyRound', icon: KeyRound, category: 'Interface', keywords: 'password security access' },
  { name: 'Link', icon: Link, category: 'Interface', keywords: 'url attach connect' },
  { name: 'Lock', icon: Lock, category: 'Interface', keywords: 'private security protected' },
  { name: 'Mail', icon: Mail, category: 'Communication', keywords: 'email message inbox' },
  { name: 'MapPin', icon: MapPin, category: 'Interface', keywords: 'location address map' },
  {
    name: 'MessageCircle',
    icon: MessageCircle,
    category: 'Communication',
    keywords: 'chat comment talk',
  },
  { name: 'Package', icon: Package, category: 'Files', keywords: 'delivery shipment box' },
  { name: 'Pencil', icon: Pencil, category: 'Interface', keywords: 'edit write compose' },
  { name: 'Phone', icon: Phone, category: 'Communication', keywords: 'call contact' },
  { name: 'Play', icon: Play, category: 'Media', keywords: 'start video audio' },
  { name: 'Search', icon: Search, category: 'Interface', keywords: 'find query' },
  { name: 'Send', icon: Send, category: 'Communication', keywords: 'share submit message' },
  { name: 'Settings2', icon: Settings2, category: 'Interface', keywords: 'preferences configure' },
  {
    name: 'ShieldCheck',
    icon: ShieldCheck,
    category: 'Interface',
    keywords: 'security verified safe',
  },
  {
    name: 'ShoppingCart',
    icon: ShoppingCart,
    category: 'Interface',
    keywords: 'store checkout buy',
  },
  { name: 'Sparkles', icon: Sparkles, category: 'Interface', keywords: 'magic ai new' },
  { name: 'Star', icon: Star, category: 'Interface', keywords: 'favorite rating featured' },
  { name: 'Tag', icon: Tag, category: 'Interface', keywords: 'label category metadata' },
  { name: 'Trash2', icon: Trash2, category: 'Interface', keywords: 'delete remove discard' },
  {
    name: 'TriangleAlert',
    icon: TriangleAlert,
    category: 'Interface',
    keywords: 'warning danger error',
  },
  { name: 'Upload', icon: Upload, category: 'Arrows', keywords: 'import add file' },
  { name: 'User', icon: User, category: 'People', keywords: 'account profile person' },
  { name: 'Users', icon: Users, category: 'People', keywords: 'team group members' },
  { name: 'Video', icon: Video, category: 'Media', keywords: 'camera recording meeting' },
  {
    name: 'WandSparkles',
    icon: WandSparkles,
    category: 'Interface',
    keywords: 'magic ai automate',
  },
  { name: 'X', icon: X, category: 'Interface', keywords: 'close cancel remove' },
  { name: 'Zap', icon: Zap, category: 'Interface', keywords: 'bolt energy fast' },
];

function IconsView() {
  const [query, setQuery] = useState('');

  const visibleIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return iconEntries.filter(
      (entry) =>
        !normalizedQuery ||
        `${entry.name} ${entry.category} ${entry.keywords}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query]);

  return (
    <div className="-mx-3 -mt-4 min-h-full bg-background px-3 pb-5 text-foreground sm:-mx-5 sm:px-5 lg:-mx-5 lg:-mt-5 lg:px-5">
      <div className="w-full">
        <div className="pt-6 sm:pt-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Icons</h1>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            {query && (
              <div className="flex items-center gap-4 rounded-full bg-card px-3 py-2 text-base font-bold uppercase tracking-wide">
                <span>“{query}”</span>
                <button
                  type="button"
                  className="flex size-4 items-center justify-center"
                  onClick={() => setQuery('')}
                  aria-label="Clear active icon filter"
                >
                  <X className="size-4 stroke-[3]" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="relative pt-3 sm:pt-4">
          <div className="flex h-12 items-center gap-2 rounded-full border-[3px] border-input bg-card text-card-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:h-16">
            <Search className="ml-5 size-6 shrink-0 stroke-[2.5] text-card-foreground sm:ml-7 sm:size-7" />
            <Input
              id="icon-search"
              className="h-full min-w-0 flex-1 rounded-full border-0 !bg-transparent px-0 pr-12 text-base font-semibold text-card-foreground shadow-none placeholder:text-card-foreground focus-visible:border-0 focus-visible:ring-0 sm:pr-14 sm:text-xl"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons"
              aria-label="Search icons"
            />
          </div>
          {query && (
            <button
              type="button"
              className="absolute top-1/2 right-4 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-2xl leading-none text-primary-foreground transition-colors hover:bg-primary/90 sm:right-6"
              onClick={() => setQuery('')}
              aria-label="Clear icon search"
            >
              <X className="size-4 stroke-[3]" />
            </button>
          )}
        </div>

        {visibleIcons.length > 0 ? (
          <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-6 sm:gap-8">
            {visibleIcons.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.name}
                  type="button"
                  className="group flex min-h-44 flex-col items-center justify-center gap-6 rounded-2xl bg-card px-2 py-3 text-center transition-transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
                  aria-label={`Select ${entry.name} icon`}
                >
                  <Icon className="size-10 text-primary stroke-[1.8] transition-transform group-hover:scale-105" />
                  <span className="text-base text-muted-foreground">
                    {entry.name.toLowerCase()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl bg-card p-5 text-center text-sm text-muted-foreground">
            No icons match your search.
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentsView({ userInitials, userName }: { userInitials: string; userName: string }) {
  return (
    <>
      <PageHeading
        eyebrow="Design system"
        title="Components"
        description="Browse every reusable UI primitive included in this reference app."
        action={
          <Badge variant="outline" className="w-fit">
            {componentNames.length} components
          </Badge>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {componentNames.map((name) => (
          <Card key={name} className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">{name}</CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  UI
                </Badge>
              </div>
              <CardDescription>Reusable {name.toLowerCase()} primitive.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-32 items-center p-3">
              <ComponentPreview name={name} userInitials={userInitials} userName={userName} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function ComponentPreview({
  name,
  userInitials,
  userName,
}: {
  name: string;
  userInitials: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid w-full gap-3">
      <div className="flex min-h-20 items-center">
        <ComponentVisual name={name} userInitials={userInitials} userName={userName} />
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        Show component
      </Button>
      {name === 'Sheet' ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet component</SheetTitle>
              <SheetDescription>
                Side panel content rendered from the component library.
              </SheetDescription>
            </SheetHeader>
            <div className="p-2 text-sm text-muted-foreground">
              Use this panel for contextual actions and details.
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{name} component</DialogTitle>
              <DialogDescription>Interactive preview from the component library.</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-muted/30 p-2">
              <ComponentVisual name={name} userInitials={userInitials} userName={userName} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ComponentVisual({
  name,
  userInitials,
  userName,
}: {
  name: string;
  userInitials: string;
  userName: string;
}) {
  if (name === 'Button')
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm">Primary</Button>
        <Button size="sm" variant="outline">
          Outline
        </Button>
      </div>
    );
  if (name === 'Badge')
    return (
      <div className="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="secondary">Muted</Badge>
      </div>
    );
  if (name === 'Input') return <Input placeholder="Type something..." />;
  if (name === 'Textarea') return <Textarea placeholder="Write a short note..." />;
  if (name === 'Checkbox')
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox defaultChecked />
        Accept updates
      </label>
    );
  if (name === 'Progress')
    return (
      <div className="w-full">
        <Progress value={64} />
        <p className="mt-2 text-xs text-muted-foreground">64% complete</p>
      </div>
    );
  if (name === 'Avatar')
    return (
      <div className="flex items-center gap-2">
        <Avatar>
          <AvatarFallback className="bg-violet-100 text-violet-700">{userInitials}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{userName}</span>
      </div>
    );
  if (name === 'Separator')
    return (
      <div className="w-full">
        <p className="text-sm">Workspace settings</p>
        <Separator className="my-3" />
        <p className="text-xs text-muted-foreground">Manage your preferences</p>
      </div>
    );
  if (name === 'Tabs')
    return (
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </Tabs>
    );
  if (name === 'Card')
    return (
      <div className="w-full rounded-lg border bg-card p-3 shadow-sm">
        <p className="text-sm font-medium">Card content</p>
        <p className="mt-1 text-xs text-muted-foreground">A contained surface.</p>
      </div>
    );
  return (
    <div className="flex w-full items-center gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-card text-xs font-semibold shadow-sm">
        UI
      </div>
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">Composable primitive</p>
      </div>
    </div>
  );
}

function Metric({ label, value, progress }: { label: string; value: string; progress: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <Progress value={progress} />
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-[720px] w-[1080px] max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[1080px]"
        aria-describedby={undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <SettingsView />
      </DialogContent>
    </Dialog>
  );
}

function SettingsView() {
  const { setTheme, theme } = useTheme();
  const [activeCategory, setActiveCategory] = useState('notifications');
  const [notifications, setNotifications] = useState({ daily: true, event: true, team: true });
  const [mobilePush, setMobilePush] = useState(true);
  const [desktop, setDesktop] = useState(true);
  const [email, setEmail] = useState(false);
  const [twoFactor, setTwoFactor] = useState(true);
  const [language, setLanguage] = useState('English');

  function setNotification(key: keyof typeof notifications, checked: boolean) {
    setNotifications((current) => ({ ...current, [key]: checked }));
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="shrink-0 lg:sticky lg:top-6 lg:w-52" aria-label="Settings categories">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Settings
          </p>
          <nav
            className="flex justify-start gap-1 overflow-x-auto lg:grid"
            aria-label="Settings navigation"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === 'notifications'}
              className={`whitespace-nowrap rounded-lg px-2 py-1 text-left text-sm ${
                activeCategory === 'notifications'
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => setActiveCategory('notifications')}
            >
              <Bell className="mr-2 inline-block size-4 align-text-bottom" />
              Notifications
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === 'appearance'}
              className={`whitespace-nowrap rounded-lg px-2 py-1 text-left text-sm ${
                activeCategory === 'appearance'
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => setActiveCategory('appearance')}
            >
              <Sun className="mr-2 inline-block size-4 align-text-bottom" />
              Appearance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === 'security'}
              className={`whitespace-nowrap rounded-lg px-2 py-1 text-left text-sm ${
                activeCategory === 'security'
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => setActiveCategory('security')}
            >
              <ShieldCheck className="mr-2 inline-block size-4 align-text-bottom" />
              Security
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === 'language'}
              className={`whitespace-nowrap rounded-lg px-2 py-1 text-left text-sm ${
                activeCategory === 'language'
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => setActiveCategory('language')}
            >
              <Globe className="mr-2 inline-block size-4 align-text-bottom" />
              Language
            </button>
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          {activeCategory === 'notifications' && (
            <section>
              <SettingsSectionTitle title="My Notifications" />
              <div className="flex flex-col gap-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:gap-6">
                  <div>
                    <h2 className="text-[19px] font-medium tracking-tight">Notify me when...</h2>
                    <div className="mt-3 grid gap-2 text-[16px] text-muted-foreground">
                      <NotificationCheckbox
                        checked={notifications.daily}
                        label="Daily productivity update"
                        onCheckedChange={(checked) => setNotification('daily', checked)}
                      />
                      <NotificationCheckbox
                        checked={notifications.event}
                        label="New event created"
                        onCheckedChange={(checked) => setNotification('event', checked)}
                      />
                      <NotificationCheckbox
                        checked={notifications.team}
                        label="When added on new team"
                        onCheckedChange={(checked) => setNotification('team', checked)}
                      />
                    </div>
                  </div>
                  <a className="text-[16px] text-primary hover:underline" href="#notifications">
                    About notifications?
                  </a>
                </div>
                <SettingsSwitchRow
                  label="Mobile push notifications"
                  description="Receive push notification whenever your organisation requires your attentions"
                  checked={mobilePush}
                  onCheckedChange={setMobilePush}
                />
                <SettingsSwitchRow
                  label="Desktop Notification"
                  description="Receive desktop notification whenever your organisation requires your attentions"
                  checked={desktop}
                  onCheckedChange={setDesktop}
                />
                <SettingsSwitchRow
                  label="Email Notification"
                  description="Receive email whenever your organisation requires your attentions"
                  checked={email}
                  onCheckedChange={setEmail}
                />
              </div>
            </section>
          )}

          {activeCategory !== 'notifications' && (
            <section>
              <SettingsSectionTitle
                title={activeCategory[0].toUpperCase() + activeCategory.slice(1)}
              />
              <div className="grid gap-6">
                {activeCategory === 'appearance' && (
                  <SettingsSelectRow
                    label="Appearance"
                    description="Customize how you theams looks on your device."
                    value={theme === 'dark' ? 'Dark' : 'Light'}
                    options={['Light', 'Dark']}
                    onChange={(value) => setTheme(value.toLowerCase())}
                  />
                )}
                {activeCategory === 'security' && (
                  <SettingsSwitchRow
                    label="Two-factor authentication"
                    description="Keep your account secure by enabling 2FA via SMS or using a temporary one-time passcode (TOTP)."
                    checked={twoFactor}
                    onCheckedChange={setTwoFactor}
                  />
                )}
                {activeCategory === 'language' && (
                  <SettingsSelectRow
                    label="Language"
                    description="Customize how you theams looks on your device."
                    value={language}
                    options={['English', 'Spanish', 'French']}
                    onChange={setLanguage}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarTools() {
  return (
    <div className="mb-5 grid gap-2 px-2">
      <Button variant="ghost" className="justify-start gap-3 px-3" aria-label="Search">
        <Search className="size-4" />
        Search
      </Button>
      <Button variant="ghost" className="justify-start gap-3 px-3" aria-label="Notifications">
        <Bell className="size-4" />
        Notifications
      </Button>
    </div>
  );
}

function SettingsSectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-4 border-b border-border pb-3">
      <h1 className="text-[25px] font-medium tracking-tight sm:text-[27px]">{title}</h1>
    </div>
  );
}

function NotificationCheckbox({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="size-[22px] rounded-md border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function SettingsSwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center sm:gap-6">
      <div>
        <h2 className="text-[19px] font-medium tracking-tight">{label}</h2>
        <p className="mt-1 max-w-4xl text-[16px] leading-6 text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
        className="h-7 w-11 data-[state=checked]:bg-primary sm:shrink-0"
      />
    </div>
  );
}

function SettingsSelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center sm:gap-6">
      <div>
        <h2 className="text-[19px] font-medium tracking-tight">{label}</h2>
        <p className="mt-1 text-[16px] leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="relative w-fit shrink-0">
        <select
          className="h-10 min-w-28 appearance-none rounded-xl border-0 bg-muted py-1 pr-7 pl-2 text-[16px] text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
