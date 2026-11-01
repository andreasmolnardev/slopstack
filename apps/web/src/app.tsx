import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ResourceForm, type ResourceFormValues } from '@/lib/slopstack/resource-form';
import { ResourceQueryControls } from '@/components/patterns/resource-query-controls';
import type { ResourceQuery } from '@/lib/slopstack/resource-client';
import { useResourceQueryState } from '@/lib/slopstack/query-state';
import { subscribePocketBaseResource } from '@/lib/slopstack/react-query';
import primitiveCatalog from '../../../packages/cli/registry.json';
import { CollectionView, CommentThread, DashboardWidget, EmptyState, InfiniteFeed, LoadingState, MediaViewer, type ThreadComment } from '@/components/patterns/advanced-patterns';
import { FeedLayout, MasterDetailLayout } from '@/components/patterns/application-layouts';
import { todoResource } from '@/resources/todos';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageHeading } from '@/components/patterns/page-heading';
import { NavigationLinks, type NavigationStyle } from '@/components/patterns/navigation-links';
import { CommandPalette } from '@/components/patterns/command-palette';
import { ResourceDataView, type ResourceDataViewMode } from '@/components/patterns/resource-data-view';
import type { DataTableColumn } from '@/components/patterns/data-table';
import { useTheme } from 'next-themes';
import { pb, pbAuth } from './api/pocketbase';
import { createPocketBaseAuthAdapter } from '@/lib/slopstack/auth-adapters';
import { createTodoRecord, deleteTodoRecord, getTodos, updateTodoRecord } from './api/todos';
import { getPreferences, savePreferences } from './api/preferences';
import type { Todo, TodoWrite } from './api/generated/types.gen';
import type { UserPreferences, UserPreferencesPatchInputBodyWritable } from './api/generated/types.gen';
import { installShortcutRegistry, ShortcutRegistry, type PaletteAction } from './lib/slopstack/search-runtime';
import type { SearchFallbackDefinition, SearchProvider, SearchResult } from './lib/slopstack/types';

type Priority = 'High' | 'Medium' | 'Low';
type View = 'overview' | 'tasks' | 'schedule' | 'analytics' | 'components' | 'icons' | 'profile';
type AuthMode = 'login' | 'register' | 'forgot-password' | 'admin-login';
type AdminSection = 'users' | 'groups' | 'sso';
type Route =
  | { kind: 'app'; view: View }
  | { kind: 'admin'; section: AdminSection }
  | { kind: 'auth'; mode: AuthMode }
  | { kind: 'not-found' };
type Task = Omit<Todo, 'priority'> & { priority: Priority };

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'components', label: 'Components', icon: Blocks },
  { id: 'icons', label: 'Icons', icon: Shapes },
];

const commandNavigation: SearchResult[] = navItems.map(({ id, label, icon }) => ({
  id,
  title: label,
  href: `/app/${id}`,
  icon,
  keywords: ['workspace', 'view', id],
}));

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

function normalizePath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}
function routeForPath(pathname: string): Route {
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
    case '/admin/groups':
      return { kind: 'admin', section: 'groups' };
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

function getUserName(user: unknown) {
  const identity = user && typeof user === 'object' ? (user as AuthIdentity) : undefined;
  const name = identity?.display_name?.trim() || identity?.name?.trim();
  if (name) return name;
  return identity?.email?.split('@')[0] || '';
}

function getUserInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)?.[0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function savedUserPreferences(): Partial<UserPreferences> {
  const userId = pb.authStore.record?.id;
  if (!userId) return {};
  try { return JSON.parse(localStorage.getItem(`slopstack.preferences.${userId}`) ?? '{}') as Partial<UserPreferences>; }
  catch { return {}; }
}

function formatDate(value: string) {
  if (!value) return 'No due date';
  const preferences = savedUserPreferences();
  const date = new Date(`${value}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat(preferences.locale || 'en-US', {
    timeZone: preferences.timeZone || 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  switch (preferences.dateFormat) {
    case 'yyyy-MM-dd': return `${values.year}-${new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: '2-digit' }).format(date)}-${new Intl.DateTimeFormat('en', { timeZone: 'UTC', day: '2-digit' }).format(date)}`;
    case 'MM/dd/yyyy': return `${new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: '2-digit' }).format(date)}/${new Intl.DateTimeFormat('en', { timeZone: 'UTC', day: '2-digit' }).format(date)}/${values.year}`;
    case 'dd/MM/yyyy': return `${new Intl.DateTimeFormat('en', { timeZone: 'UTC', day: '2-digit' }).format(date)}/${new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: '2-digit' }).format(date)}/${values.year}`;
    default: return new Intl.DateTimeFormat(preferences.locale || 'en-US', {
      timeZone: preferences.timeZone || 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    }).format(date);
  }
}

function formatTime(hour: number, minute: number) {
  const preferences = savedUserPreferences();
  const value = new Date(Date.UTC(2026, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(preferences.locale || 'en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit',
    hourCycle: preferences.timeFormat === '24h' ? 'h23' : 'h12',
  }).format(value);
}

function priorityClass(priority: Priority) {
  return priority === 'High'
    ? 'bg-rose-100 text-rose-700'
    : priority === 'Medium'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-sky-100 text-sky-700';
}

function applyThemeTokens(tokens: UserPreferences['themeTokens']) {
  document.documentElement.style.setProperty('--primary', tokens.primary);
  document.documentElement.style.setProperty('--ring', tokens.primary);
  document.documentElement.style.setProperty('--sidebar-primary', tokens.primary);
  document.documentElement.style.setProperty('--sidebar-ring', tokens.primary);
  document.documentElement.style.setProperty('--accent', tokens.accent);
  document.documentElement.style.setProperty('--radius', tokens.radius);
}

function applyMotionPreferences(motion: UserPreferences['motion']) {
  const root = document.documentElement;
  const duration = { fast: '120ms', normal: '200ms', slow: '360ms' }[motion.duration] ?? '200ms';
  const easing = {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
    snappy: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  }[motion.easing] ?? 'cubic-bezier(0.2, 0, 0, 1)';
  root.dataset.motionStyle = motion.style;
  root.style.setProperty('--slopstack-motion-duration', duration);
  root.style.setProperty('--slopstack-motion-easing', easing);
}

export function App() {
  const { pathname, navigate } = useNavigation();
  const { setTheme } = useTheme();
  const route = routeForPath(pathname);
  const [authRevision, refreshAuth] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskError, setTaskError] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskQuery, updateTaskQuery] = useResourceQueryState(todoResource.query ?? {});
  const taskFilter = String(taskQuery.filters?.status ?? 'all');
  const setTaskFilter = (status: string) => updateTaskQuery({ filters: status === 'all' ? {} : { status } });
  const [navigationStyle, setNavigationStyle] = useState<NavigationStyle>('sidebar');
  const search = taskQuery.search ?? '';
  const setSearch = (search: string) => updateTaskQuery({ search });
  const taskSort = taskQuery.sort ?? todoResource.query?.defaultSort ?? '';
  const setTaskSort = (sort: string) => updateTaskQuery({ sort });
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    dueDate: '',
    priority: 'Medium' as Priority,
  });
  const isAuthenticated = pb.authStore.isValid;
  const authUserId = pb.authStore.record?.id ?? '';
  const isSuperuser = pb.authStore.record?.collectionName === '_superusers';
  const isAdmin = isSuperuser || pb.authStore.record?.isAdmin === true;
  const openNewTask = useCallback(() => {
    setEditingTask(null);
    setNewTask({ title: '', description: '', dueDate: '', priority: 'Medium' });
    setTaskDialogOpen(true);
  }, []);
  const searchProviders = useMemo<SearchProvider[]>(() => [{
    id: 'todos',
    label: 'Tasks',
    minQueryLength: 2,
    async search(query) {
      const normalized = query.toLocaleLowerCase();
      return tasks
        .filter((task) => `${task.title} ${task.description}`.toLocaleLowerCase().includes(normalized))
        .slice(0, 8)
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description || task.priority,
          href: '/app/tasks',
          keywords: [task.priority, task.completed ? 'completed' : 'active'],
        }));
    },
  }], [tasks]);
  const commandActions = useMemo<PaletteAction[]>(() => [{
    id: 'create-task',
    label: 'Create task',
    description: 'Add a task to your workspace',
    keywords: ['new', 'todo', 'add'],
    shortcut: 'N',
    access: { authenticated: true, permission: 'todos:create' },
    execute: openNewTask,
  }], [openNewTask]);
  const commandSearchFallbacks = useMemo<SearchFallbackDefinition[]>(() => [{
    id: 'search-all-tasks',
    label: 'Search all tasks for "{query}"',
    description: 'Open the task list with this query applied.',
    minQueryLength: 2,
    execute: ({ input, navigate: go }) => go(`/app/tasks?q=${encodeURIComponent(input)}`),
  }], []);

  useEffect(() => {
    const shortcuts = new ShortcutRegistry([{
      id: 'create-task', keys: ['n'], label: 'Create task', access: { authenticated: true }, execute: openNewTask,
    }]);
    return installShortcutRegistry(shortcuts, { authorize: () => isAuthenticated });
  }, [isAuthenticated, openNewTask]);

  useEffect(() => {
    if (!authUserId) {
      setNavigationStyle('sidebar');
      return;
    }
    let active = true;
    getPreferences().then((preferences) => {
      if (!active) return;
      localStorage.setItem(`slopstack.preferences.${authUserId}`, JSON.stringify(preferences));
      setTheme(preferences.theme);
      applyThemeTokens(preferences.themeTokens);
      applyMotionPreferences(preferences.motion);
      setNavigationStyle(preferences.navigation as NavigationStyle);
    }).catch(() => undefined);
    const onPreferencesChange = (event: Event) => {
      const preferences = (event as CustomEvent<Partial<UserPreferences>>).detail;
      if (preferences.navigation) setNavigationStyle(preferences.navigation as NavigationStyle);
      if (preferences.theme) setTheme(preferences.theme);
      if (preferences.themeTokens) applyThemeTokens(preferences.themeTokens);
      if (preferences.motion) applyMotionPreferences(preferences.motion);
    };
    window.addEventListener('slopstack:preferences', onPreferencesChange);
    return () => {
      active = false;
      window.removeEventListener('slopstack:preferences', onPreferencesChange);
    };
  }, [authUserId, setTheme]);

  useEffect(() => {
    return pbAuth.subscribe(() => refreshAuth((value) => value + 1));
  }, []);

  useEffect(() => {
    let active = true;
    if (!authUserId) {
      setTasks([]);
      setTasksLoading(false);
      return;
    }

    setTasksLoading(true);
    setTaskError('');
    getTodos()
      .then((records) => {
        if (active) setTasks(records as Task[]);
      })
      .catch(() => {
        if (active) setTaskError('Could not load your tasks. Please try again.');
      })
      .finally(() => {
        if (active) setTasksLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authRevision, authUserId]);

  useEffect(() => {
    if (!authUserId) return;
    let active = true;
    const stop = subscribePocketBaseResource(pb, 'todos', () => {
      void getTodos().then((records) => {
        if (active) setTasks(records as Task[]);
      }).catch(() => {
        if (active) setTaskError('Could not sync your tasks. Please try again.');
      });
    });
    return () => { active = false; stop(); };
  }, [authUserId]);

  const completed = tasks.filter((task) => task.completed).length;
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesFilter =
          taskFilter === 'all' ||
          (taskFilter === 'active' && !task.completed) ||
          (taskFilter === 'completed' && task.completed);
        const query = search.trim().toLowerCase();
        return (
          matchesFilter &&
          (!query || `${task.title} ${task.description}`.toLowerCase().includes(query))
        );
      }),
    [search, taskFilter, tasks],
  );

  function signOut() {
    void pbAuth.signOut();
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

  const view = route.view;
  const user = pb.authStore.record;
  const userName = getUserName(user);
  const userInitials = getUserInitials(userName);

  function openTaskEditor(task?: Task) {
    setTaskError('');
    setEditingTask(task ?? null);
    setNewTask(
      task
        ? {
            title: task.title,
            description: task.description,
            dueDate: task.due_date,
            priority: task.priority,
          }
        : { title: '', description: '', dueDate: '', priority: 'Medium' },
    );
    setTaskDialogOpen(true);
  }

  async function saveTask(values: ResourceFormValues) {
    const title = String(values.title ?? '').trim();
    if (!title) return;
    const input: TodoWrite = {
      title,
      description: String(values.description ?? '').trim(),
      due_date: String(values.due_date ?? ''),
      priority: String(values.priority ?? 'Medium'),
    };
    setTaskSaving(true);
    setTaskError('');
    try {
      const saved = editingTask
        ? await updateTodoRecord(editingTask.id, input)
        : await createTodoRecord(input);
      const savedTask = saved as Task;
      setTasks((current) =>
        editingTask
          ? current.map((task) => (task.id === savedTask.id ? savedTask : task))
          : [savedTask, ...current],
      );
      setTaskDialogOpen(false);
      setEditingTask(null);
    } catch {
      setTaskError('Could not save this task. Check the fields and try again.');
    } finally {
      setTaskSaving(false);
    }
  }

  async function toggleTask(id: string, completed: boolean) {
    setTaskError('');
    try {
      const saved = (await updateTodoRecord(id, { completed })) as Task;
      setTasks((current) => current.map((task) => (task.id === id ? saved : task)));
    } catch {
      setTaskError('Could not update this task. Please try again.');
    }
  }

  async function deleteTask(id: string) {
    setTaskError('');
    try {
      await deleteTodoRecord(id);
      setTasks((current) => current.filter((task) => task.id !== id));
    } catch {
      setTaskError('Could not delete this task. Please try again.');
    }
  }

  function renderView() {
    if (view === 'tasks')
      return (
        <TasksView
          tasks={visibleTasks}
          onToggle={toggleTask}
          onDelete={deleteTask}
          onEdit={(task) => openTaskEditor(task)}
          tasksLoading={tasksLoading}
          search={search}
          onSearch={setSearch}
          filter={taskFilter}
          onFilter={setTaskFilter}
          sort={taskSort}
          onSort={setTaskSort}
          onAdd={() => openTaskEditor()}
        />
      );
    if (view === 'schedule') return <ScheduleView tasks={tasks} onToggle={toggleTask} />;
    if (view === 'analytics') return <AnalyticsView tasks={tasks} />;
    if (view === 'components') {
      return <ComponentsView userInitials={userInitials} userName={userName} />;
    }
    if (view === 'icons') return <IconsView />;
    if (view === 'profile') return <SettingsView />;
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
            <Button className="gap-2" onClick={() => openTaskEditor()}>
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
                    Tasks are stored in PocketBase and scoped to your account.
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
              <Tabs value={taskFilter} onValueChange={setTaskFilter} className="border-b px-6 pt-4">
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
              {tasksLoading ? (
                <p className="p-10 text-center text-sm text-muted-foreground">Loading tasks…</p>
              ) : (
                <div className="divide-y">
                  {visibleTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={toggleTask}
                      onDelete={deleteTask}
                      onEdit={(item) => openTaskEditor(item)}
                    />
                  ))}
                  {visibleTasks.length === 0 && (
                    <div className="p-10 text-center text-sm text-muted-foreground">
                      No tasks match current filter.
                    </div>
                  )}
                </div>
              )}
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
                {[
                  { title: 'Team sync', day: 'Today', hour: 14, minute: 0 },
                  { title: 'Design review', day: 'Tomorrow', hour: 10, minute: 30 },
                  { title: 'Launch retro', day: 'Friday', hour: 16, minute: 0 },
                ].map((item) => (
                  <div className="flex items-center gap-3" key={item.title}>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.day}, {formatTime(item.hour, item.minute)}
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
    <main data-navigation={navigationStyle} className="h-screen overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-full max-w-[1600px]">
        <aside className={`hidden h-full shrink-0 flex-col border-r bg-card py-6 lg:flex ${navigationStyle === 'rail' ? 'w-20 px-2' : 'w-64 px-4'} ${navigationStyle === 'topbar' || navigationStyle === 'bottom' ? 'lg:hidden' : ''}`}>
          <div className="flex items-center gap-3 px-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Check className="size-5" />
            </div>
            <div className={navigationStyle === 'rail' ? 'sr-only' : ''}>
              <p className="font-semibold tracking-tight">Slopstack</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Reference app
              </p>
            </div>
          </div>
          <div className={`mt-10 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground ${navigationStyle === 'rail' ? 'sr-only' : ''}`}>
            Workspace
          </div>
          <div className="mt-3">
            <NavigationLinks items={navItems} activeId={view} layout={navigationStyle} label="Workspace navigation" onNavigate={(id) => navigate(`/app/${id}`)} />
          </div>
          <div className={`mt-9 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground ${navigationStyle === 'rail' ? 'sr-only' : ''}`}>
            Manage
          </div>
          <nav className="mt-3 grid gap-1">
            <Button
              variant={view === 'profile' ? 'secondary' : 'ghost'}
              className={`justify-start gap-3 ${navigationStyle === 'rail' ? 'justify-center px-0' : ''}`}
              onClick={() => navigate('/app/profile')}
            >
              <Settings2 className="size-4" />
              <span className={navigationStyle === 'rail' ? 'sr-only' : ''}>Settings</span>
            </Button>
            <Button
              variant="ghost"
              className={`justify-start gap-3 ${navigationStyle === 'rail' ? 'justify-center px-0' : ''}`}
              onClick={() => window.open('/docs', '_blank')}
            >
              <FileText className="size-4" />
              <span className={navigationStyle === 'rail' ? 'sr-only' : ''}>API docs</span>
              <ArrowUpRight className="ml-auto size-3" />
            </Button>
            {isSuperuser && (
              <Button
                variant="ghost"
                className={`justify-start gap-3 ${navigationStyle === 'rail' ? 'justify-center px-0' : ''}`}
                onClick={() => navigate('/admin/users')}
              >
                <UserCog className="size-4" />
                <span className={navigationStyle === 'rail' ? 'sr-only' : ''}>Admin console</span>
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                className={`justify-start gap-3 ${navigationStyle === 'rail' ? 'justify-center px-0' : ''}`}
                onClick={() => navigate('/app/profile')}
              >
                <ShieldCheck className="size-4" />
                <span className={navigationStyle === 'rail' ? 'sr-only' : ''}>Admin settings</span>
              </Button>
            )}
          </nav>
          {navigationStyle !== 'rail' && <SidebarTools />}
          <div className="mt-auto pt-24">
            <Separator className="mb-5" />
            <div className="flex items-center gap-3 px-2">
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
          <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/90 px-5 backdrop-blur sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="flex size-8 items-center justify-center rounded-lg bg-slate-950 text-white">
                <Check className="size-4" />
              </div>
              <span className="font-semibold">Slopstack</span>
            </div>
            <div className={`hidden items-center gap-2 text-sm text-muted-foreground lg:flex ${navigationStyle === 'topbar' ? 'lg:hidden' : ''}`}>
              {view === 'profile' ? (
                <>
                  <span>Manage</span>
                  <span>/</span>
                  <span className="font-medium text-foreground">Settings</span>
                </>
              ) : (
                <>
                  <span>Workspace</span>
                  <span>/</span>
                  <span className="font-medium text-foreground">
                    {view === 'overview' ? 'Overview' : view[0].toUpperCase() + view.slice(1)}
                  </span>
                </>
              )}
            </div>
            {navigationStyle === 'topbar' && (
              <div className="hidden lg:block">
                <NavigationLinks items={navItems} activeId={view} layout="topbar" label="Workspace navigation" onNavigate={(id) => navigate(`/app/${id}`)} />
              </div>
            )}
            <div className="hidden shrink-0 sm:block">
              <CommandPalette
                navigation={commandNavigation}
                providers={searchProviders}
                actions={commandActions}
                searchFallbacks={commandSearchFallbacks}
                onNavigate={navigate}
                canAccess={(requirement) => !requirement?.authenticated || isAuthenticated}
                authorize={(requirement) => !requirement?.authenticated || isAuthenticated}
              />
            </div>
            <div className="ml-auto flex items-center gap-1 lg:hidden">
              <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => navigate('/app/profile')}>
                <Settings2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
                <LogOut className="size-4" />
              </Button>
            </div>
            {(navigationStyle === 'topbar' || navigationStyle === 'bottom') && (
              <div className="hidden items-center gap-2 lg:flex">
                <span className="max-w-40 truncate text-sm text-muted-foreground">{userName}</span>
                <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => navigate('/app/profile')}>
                  <Settings2 className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
                  <LogOut className="size-4" />
                </Button>
              </div>
            )}
          </header>
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${
              view === 'profile'
                ? 'px-4 py-5 sm:px-6 lg:px-7 lg:py-6'
                : 'px-5 py-8 sm:px-8 lg:px-10 lg:py-10'
            }`}
          >
            <div className="mx-auto max-w-7xl">{renderView()}</div>
            {taskError && (
              <p className="mx-auto mt-4 max-w-7xl text-sm text-destructive" role="alert">
                {taskError}
              </p>
            )}
          </div>
          <div className={`shrink-0 border-t bg-card px-3 py-2 ${navigationStyle === 'bottom' ? 'lg:px-10' : 'lg:hidden'}`}>
            <NavigationLinks items={navItems} activeId={view} layout="bottom" label="Workspace navigation" onNavigate={(id) => navigate(`/app/${id}`)} />
          </div>
        </div>
      </div>
      <TaskEditorDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        editing={Boolean(editingTask)}
        value={newTask}
        onSubmit={saveTask}
        saving={taskSaving}
        error={taskError}
        onError={setTaskError}
      />
    </main>
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

      await createPocketBaseAuthAdapter(pb, collection).signIn({ identity: email.trim(), password });
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
    <main className="relative flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
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
  isAdmin?: boolean;
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
    <main className="relative flex min-h-screen items-center justify-center bg-background px-5 text-center text-foreground">
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
      <div className="mx-auto flex h-full max-w-[1600px]">
        <aside className="hidden h-full w-64 shrink-0 flex-col border-r bg-card px-4 py-6 lg:flex">
          <div className="flex items-center gap-3 px-3">
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
          <p className="mt-10 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
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
              variant={section === 'groups' ? 'secondary' : 'ghost'}
              className="justify-start gap-3"
              onClick={() => navigate('/admin/groups')}
            >
              <Users className="size-4" />
              Groups
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
          <div className="mt-auto pt-24">
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
          <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/90 px-5 backdrop-blur sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <UserCog className="size-5" />
              <span className="font-semibold">Admin console</span>
            </div>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
              <span>Admin</span>
              <span>/</span>
              <span className="font-medium text-foreground">
                {section === 'users' ? 'Users' : section === 'groups' ? 'Groups' : 'SSO & security'}
              </span>
            </div>
            <Button variant="ghost" className="gap-2 px-2" onClick={onSignOut}>
              <ShieldCheck className="size-4 text-emerald-600" />
              <span className="text-sm">Superuser</span>
              <LogOut className="size-4 text-muted-foreground" />
            </Button>
            <ThemeToggle />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
            <div className="mx-auto max-w-7xl">
              {section === 'users' ? <AdminUsersView /> : section === 'groups' ? <AdminGroupsView /> : <AdminSsoView />}
            </div>
          </div>
          <nav className="flex shrink-0 border-t bg-card px-3 py-2 lg:hidden">
            <Button
              variant={section === 'users' ? 'secondary' : 'ghost'}
              className="flex-1 gap-2"
              onClick={() => navigate('/admin/users')}
            >
              <Users className="size-4" />
              Users
            </Button>
            <Button
              variant={section === 'groups' ? 'secondary' : 'ghost'}
              className="flex-1 gap-2"
              onClick={() => navigate('/admin/groups')}
            >
              <Users className="size-4" />
              Groups
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
  const [permissionCatalog, setPermissionCatalog] = useState<ManagedPermission[]>([]);
  const [userRules, setUserRules] = useState<Array<{ id: string; user: string; permission: string; denied?: boolean }>>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<Record<string, string>>({});
  const [permissionEffects, setPermissionEffects] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const [nextUsers, nextPermissions, nextRules] = await Promise.all([
        pb.collection('users').getFullList<ManagedUser>({ sort: '-created' }),
        pb.collection('permissions').getFullList<ManagedPermission>({ sort: 'name' }),
        pb.collection('user_permissions').getFullList<{ id: string; user: string; permission: string; denied?: boolean }>(),
      ]);
      setUsers(nextUsers);
      setPermissionCatalog(nextPermissions);
      setUserRules(nextRules);
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

  async function addUserRule(user: ManagedUser) {
    const permission = selectedPermissions[user.id];
    if (!permission) return;
    try {
      await pb.collection('user_permissions').create({
        user: user.id,
        permission,
        denied: permissionEffects[user.id] === 'deny',
      });
      await loadUsers();
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'Unable to update user permissions.');
    }
  }

  async function removeUserRule(rule: { id: string }) {
    try {
      await pb.collection('user_permissions').delete(rule.id);
      await loadUsers();
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'Unable to remove user permission.');
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
          {error && <p className="border-b px-6 py-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading users...</div>
          ) : visibleUsers.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No users found.</div>
          ) : (
            <div className="divide-y">
              {visibleUsers.map((user) => (
                <div
                  className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center"
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
                  <div className="grid w-full gap-2 sm:w-72">
                    {userRules.filter((rule) => rule.user === user.id).map((rule) => (
                      <div key={rule.id} className="flex items-center justify-between gap-2 text-xs">
                        <span>{rule.permission} · {rule.denied ? 'Denied' : 'Allowed'}</span>
                        <Button variant="ghost" size="sm" onClick={() => void removeUserRule(rule)}>Remove</Button>
                      </div>
                    ))}
                    {permissionCatalog.length > 0 && (
                      <div className="flex gap-2">
                        <select className="h-9 min-w-0 flex-1 rounded-xl border bg-background px-2 text-xs" aria-label={`Direct permission for ${user.email}`} value={selectedPermissions[user.id] ?? ''} onChange={(event) => setSelectedPermissions((current) => ({ ...current, [user.id]: event.target.value }))}>
                          <option value="">Choose permission…</option>
                          {permissionCatalog.map((permission) => <option key={permission.id} value={permission.name}>{permission.name}</option>)}
                        </select>
                        <select className="h-9 rounded-xl border bg-background px-2 text-xs" aria-label="Direct permission effect" value={permissionEffects[user.id] ?? 'allow'} onChange={(event) => setPermissionEffects((current) => ({ ...current, [user.id]: event.target.value }))}>
                          <option value="allow">Allow</option><option value="deny">Deny</option>
                        </select>
                        <Button variant="outline" size="sm" onClick={() => void addUserRule(user)} disabled={!selectedPermissions[user.id]}>Set</Button>
                      </div>
                    )}
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

type ManagedGroup = { id: string; name: string; description?: string; organization?: string };
type ManagedOrganization = { id: string; name: string };
type ManagedMembership = { id: string; group: string; user: string };
type ManagedPermission = { id: string; name: string; category?: string };
type GroupPermission = { id: string; group: string; permission: string; denied?: boolean };

function AdminGroupsView() {
  const [groups, setGroups] = useState<ManagedGroup[]>([]);
  const [organizations, setOrganizations] = useState<ManagedOrganization[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [memberships, setMemberships] = useState<ManagedMembership[]>([]);
  const [permissions, setPermissions] = useState<ManagedPermission[]>([]);
  const [groupPermissions, setGroupPermissions] = useState<GroupPermission[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [organization, setOrganization] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string>>({});
  const [selectedPermissions, setSelectedPermissions] = useState<Record<string, string>>({});
  const [permissionEffects, setPermissionEffects] = useState<Record<string, string>>({});
  const [permissionName, setPermissionName] = useState('');
  const [permissionCategory, setPermissionCategory] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const [nextGroups, nextUsers, nextMemberships, nextPermissions, nextGroupPermissions, nextOrganizations] = await Promise.all([
        pb.collection('groups').getFullList<ManagedGroup>({ sort: 'name' }),
        pb.collection('users').getFullList<ManagedUser>({ sort: 'email' }),
        pb.collection('group_members').getFullList<ManagedMembership>(),
        pb.collection('permissions').getFullList<ManagedPermission>({ sort: 'name' }),
        pb.collection('group_permissions').getFullList<GroupPermission>(),
        pb.collection('organizations').getFullList<ManagedOrganization>({ sort: 'name' }),
      ]);
      setGroups(nextGroups);
      setUsers(nextUsers);
      setMemberships(nextMemberships);
      setPermissions(nextPermissions);
      setGroupPermissions(nextGroupPermissions);
      setOrganizations(nextOrganizations);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load groups.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    try {
      await pb.collection('groups').create({ name: name.trim(), description: description.trim(), organization });
      setName('');
      setDescription('');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create group.');
    }
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    try {
      await pb.collection('organizations').create({ name: organizationName.trim() });
      setOrganizationName('');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create organization.');
    }
  }

  async function addMember(group: ManagedGroup) {
    const user = selectedUsers[group.id];
    if (!user) return;
    try {
      await pb.collection('group_members').create({ group: group.id, user });
      setSelectedUsers((current) => ({ ...current, [group.id]: '' }));
      await load();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add group member.');
    }
  }

  async function removeMember(membership: ManagedMembership) {
    try {
      await pb.collection('group_members').delete(membership.id);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove group member.');
    }
  }

  async function createPermission(event: FormEvent) {
    event.preventDefault();
    try {
      await pb.collection('permissions').create({ name: permissionName.trim(), category: permissionCategory.trim() });
      setPermissionName('');
      setPermissionCategory('');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create permission.');
    }
  }

  async function addGroupPermission(group: ManagedGroup) {
    const permission = selectedPermissions[group.id];
    if (!permission) return;
    try {
      await pb.collection('group_permissions').create({
        group: group.id,
        permission,
        denied: permissionEffects[group.id] === 'deny',
      });
      await load();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Unable to assign permission.');
    }
  }

  async function removeGroupPermission(rule: GroupPermission) {
    try {
      await pb.collection('group_permissions').delete(rule.id);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove permission rule.');
    }
  }

  async function deleteGroup(group: ManagedGroup) {
    if (!window.confirm(`Delete the ${group.name} group and its memberships?`)) return;
    try {
      await Promise.all(memberships.filter((member) => member.group === group.id).map((member) => pb.collection('group_members').delete(member.id)));
      await pb.collection('groups').delete(group.id);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete group.');
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeading eyebrow="Administration" title="Groups" description="Create groups and manage their user memberships." />
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Card>
        <CardHeader><CardTitle>Organizations</CardTitle><CardDescription>Optional tenant scope. Single-user apps can leave this empty.</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={(event) => void createOrganization(event)}>
            <Input aria-label="Organization name" placeholder="Organization name" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required />
            <Button type="submit">Create organization</Button>
          </form>
          <div className="flex flex-wrap gap-2">{organizations.map((item) => <Badge key={item.id} variant="outline">{item.name}</Badge>)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Create a group</CardTitle><CardDescription>Groups can receive shared permissions.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_1fr_auto]" onSubmit={(event) => void createGroup(event)}>
            <Input aria-label="Group name" placeholder="Group name" value={name} onChange={(event) => setName(event.target.value)} required />
            <Input aria-label="Description" placeholder="Description" value={description} onChange={(event) => setDescription(event.target.value)} />
            <select className="h-10 rounded-xl border bg-background px-3 text-sm" aria-label="Organization scope" value={organization} onChange={(event) => setOrganization(event.target.value)}>
              <option value="">No organization</option>
              {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Button type="submit">Create group</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Permission catalog</CardTitle><CardDescription>Define named permissions that group rules can grant or deny.</CardDescription></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => void createPermission(event)}>
            <Input aria-label="Permission name" placeholder="todos.read" value={permissionName} onChange={(event) => setPermissionName(event.target.value)} required />
            <Input aria-label="Permission category" placeholder="Todos" value={permissionCategory} onChange={(event) => setPermissionCategory(event.target.value)} />
            <Button type="submit">Add permission</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">{permissions.map((permission) => <Badge key={permission.id} variant="secondary">{permission.name}</Badge>)}</div>
        </CardContent>
      </Card>
      {groups.map((group) => {
        const members = memberships.filter((member) => member.group === group.id);
        const availableUsers = users.filter((user) => !members.some((member) => member.user === user.id));
        return (
          <Card key={group.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div><CardTitle>{group.name}</CardTitle><CardDescription>{group.description || 'No description'} · {group.organization ? `${organizations.find((item) => item.id === group.organization)?.name ?? 'Organization'} · ` : ''}{members.length} members</CardDescription></div>
              <Button variant="destructive" size="sm" onClick={() => void deleteGroup(group)}>Delete</Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              {members.map((member) => {
                const user = users.find((candidate) => candidate.id === member.user);
                return <div key={member.id} className="flex items-center justify-between border-t pt-3 text-sm"><span>{user?.display_name || user?.email || member.user}</span><Button variant="ghost" size="sm" onClick={() => void removeMember(member)}>Remove</Button></div>;
              })}
              {availableUsers.length > 0 && (
                <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
                  <select className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm" aria-label={`Add member to ${group.name}`} value={selectedUsers[group.id] ?? ''} onChange={(event) => setSelectedUsers((current) => ({ ...current, [group.id]: event.target.value }))}>
                    <option value="">Choose a user…</option>
                    {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.display_name || user.email}</option>)}
                  </select>
                  <Button variant="outline" onClick={() => void addMember(group)} disabled={!selectedUsers[group.id]}>Add member</Button>
                </div>
              )}
              <div className="grid gap-3 border-t pt-3">
                <p className="text-sm font-medium">Permission rules</p>
                {groupPermissions.filter((rule) => rule.group === group.id).map((rule) => {
                  const permission = permissions.find((candidate) => candidate.id === rule.permission || candidate.name === rule.permission);
                  return <div key={rule.id} className="flex items-center justify-between text-sm"><span>{permission?.name ?? rule.permission} · {rule.denied ? 'Denied' : 'Allowed'}</span><Button variant="ghost" size="sm" onClick={() => void removeGroupPermission(rule)}>Remove</Button></div>;
                })}
                {permissions.length > 0 && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm" aria-label={`Permission for ${group.name}`} value={selectedPermissions[group.id] ?? ''} onChange={(event) => setSelectedPermissions((current) => ({ ...current, [group.id]: event.target.value }))}>
                      <option value="">Choose a permission…</option>
                      {permissions.map((permission) => <option key={permission.id} value={permission.name}>{permission.name}</option>)}
                    </select>
                    <select className="h-10 rounded-xl border bg-background px-3 text-sm" aria-label="Permission effect" value={permissionEffects[group.id] ?? 'allow'} onChange={(event) => setPermissionEffects((current) => ({ ...current, [group.id]: event.target.value }))}>
                      <option value="allow">Allow</option><option value="deny">Deny</option>
                    </select>
                    <Button variant="outline" onClick={() => void addGroupPermission(group)} disabled={!selectedPermissions[group.id]}>Add rule</Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
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
        <CardContent className="flex items-center justify-between gap-4 border-t pt-5">
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
          <code className="block rounded-lg bg-muted p-3 text-sm">
            {window.location.origin}/api/oauth2-redirect
          </code>
        </CardContent>
      </Card>
    </>
  );
}

function NotFoundPage({ navigate }: { navigate: (path: string, replace?: boolean) => void }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-5 text-center text-foreground">
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
      <CardContent className="flex items-center gap-4 p-5">
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
  onEdit,
  tasksLoading,
  search,
  onSearch,
  filter,
  onFilter,
  sort,
  onSort,
  onAdd,
}: {
  tasks: Task[];
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
  tasksLoading: boolean;
  search: string;
  onSearch: (value: string) => void;
  filter: string;
  onFilter: (value: string) => void;
  sort: string;
  onSort: (value: string) => void;
  onAdd: () => void;
}) {
  const [mode, setMode] = useState<ResourceDataViewMode>('list');
  const [selection, setSelection] = useState<readonly string[]>([]);
  useEffect(() => setSelection([]), [filter, search]);
  const query: ResourceQuery = {
    search,
    sort,
    filters: filter === 'all' ? {} : { status: filter },
  };
  const sortedTasks = [...tasks].sort((a, b) => {
    const descending = sort.startsWith('-');
    const field = sort.replace(/^-/, '').split(',')[0];
    const comparison = field === 'title' ? a.title.localeCompare(b.title)
      : field === 'priority' ? a.priority.localeCompare(b.priority)
        : field === 'created' ? a.created.localeCompare(b.created)
          : a.due_date.localeCompare(b.due_date);
    return descending ? -comparison : comparison;
  });

  const columns: DataTableColumn<Task>[] = [
    {
      id: 'title', header: 'Task',
      cell: (task) => <div className="min-w-40"><span className={`font-medium ${task.completed ? 'text-muted-foreground line-through' : ''}`}>{task.title}</span><p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{task.description}</p></div>,
    },
    { id: 'priority', header: 'Priority', cell: (task) => <Badge variant="outline" className={priorityClass(task.priority)}>{task.priority}</Badge> },
    { id: 'due', header: 'Due', cell: (task) => <span className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(task.due_date)}</span> },
    { id: 'status', header: 'Status', cell: (task) => <Badge variant={task.completed ? 'secondary' : 'outline'}>{task.completed ? 'Complete' : 'Active'}</Badge> },
    {
      id: 'actions', header: 'Actions',
      cell: (task) => <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => onEdit(task)}>Edit</Button><Button variant="ghost" size="sm" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)}><Trash2 className="size-4" /></Button></div>,
    },
  ];

  const bulkComplete = () => {
    for (const id of selection) onToggle(id, true);
    setSelection([]);
  };
  const bulkDelete = () => {
    for (const id of selection) onDelete(id);
    setSelection([]);
  };

  return (
    <>
      <PageHeading
        eyebrow="Example module"
        title="Tasks"
        description="A replaceable feature screen with filters, ownership, priorities, and due dates."
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
              <CardDescription>
                These tasks are stored in PocketBase and can be edited from this list.
              </CardDescription>
            </div>
            <div className="min-w-0 flex-1 sm:max-w-3xl">
              <ResourceQueryControls
                resource={todoResource}
                value={query}
                onChange={(next) => {
                  onSearch(next.search ?? '');
                  onFilter(String(next.filters?.status ?? 'all'));
                  onSort(next.sort ?? todoResource.query?.defaultSort ?? '');
                }}
              />
            </div>
            <Select value={mode} onValueChange={(value) => setMode(value as ResourceDataViewMode)}>
              <SelectTrigger className="w-36" aria-label="Task display style"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="list">List view</SelectItem>
                <SelectItem value="table">Table view</SelectItem>
                <SelectItem value="cards">Card view</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {selection.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-6 py-3">
              <span className="text-sm text-muted-foreground">{selection.length} selected</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={bulkComplete}>Mark complete</Button>
                <Button variant="destructive" size="sm" onClick={bulkDelete}>Delete selected</Button>
                <Button variant="ghost" size="sm" onClick={() => setSelection([])}>Clear</Button>
              </div>
            </div>
          )}
          {tasksLoading ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Loading tasks…</p>
          ) : (
            <div className="p-4 sm:p-6">
              <ResourceDataView
                rows={sortedTasks}
                columns={columns}
                getRowKey={(task) => task.id}
                mode={mode}
                selection={selection}
                onSelectionChange={setSelection}
                selectable
                emptyMessage="No tasks match the current filters."
                renderItem={(task) => (
                  <div className="flex min-w-0 items-start gap-3">
                    <Checkbox aria-label={`Complete ${task.title}`} checked={task.completed} onCheckedChange={(checked) => onToggle(task.id, checked === true)} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${task.completed ? 'text-muted-foreground line-through' : ''}`}>{task.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="outline" className={priorityClass(task.priority)}>{task.priority}</Badge><span className="text-xs text-muted-foreground">{formatDate(task.due_date)}</span></div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${task.title}`} onClick={() => onEdit(task)}><MoreHorizontal className="size-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${task.title}`} onClick={() => onDelete(task.id)}><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  onEdit,
}: {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  return (
    <div className="group flex items-start gap-4 px-6 py-4 transition-colors hover:bg-muted/20">
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
        <p className="mt-1 truncate text-xs text-muted-foreground">{task.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={priorityClass(task.priority)}>
            {task.priority}
          </Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            {formatDate(task.due_date)}
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
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${task.title}`}
          onClick={() => onEdit(task)}
        >
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

type TaskEditorValue = {
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
};

function TaskEditorDialog({
  open,
  onOpenChange,
  editing,
  value,
  onSubmit,
  saving,
  error,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  value: TaskEditorValue;
  onSubmit: (values: ResourceFormValues) => void | Promise<void>;
  saving: boolean;
  error: string;
  onError: (message: string) => void;
}) {
  const initialValues: ResourceFormValues = {
    title: value.title,
    description: value.description,
    due_date: value.dueDate,
    priority: value.priority,
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit task' : 'Add new task'}</DialogTitle>
          <DialogDescription>
            Tasks are saved to your account and can be changed later.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {open && <ResourceForm
          key={`${open}:${editing ? value.title : 'new'}`}
          resource={todoResource}
          initialValues={initialValues}
          submitLabel={saving ? 'Saving…' : editing ? 'Save task' : 'Create task'}
          onSubmit={onSubmit}
          onError={(cause) => onError(cause instanceof Error ? cause.message : 'Could not save this task.')}
        />}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <CardContent className="grid gap-4 p-5 sm:grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
            <div
              className={`rounded-xl p-3 text-center ${index === 3 ? 'bg-slate-950 text-white' : 'bg-muted/40'}`}
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
            <CardContent className="flex items-center gap-4 p-5">
              <div className="w-20 text-xs font-medium text-muted-foreground">
                {['09:00 AM', '10:30 AM', '01:00 PM', '03:30 PM'][index]}
              </div>
              <div className="h-10 w-1 rounded-full bg-slate-950" />
              <div className="flex-1">
                <p className="font-medium">{task.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(task.due_date)} · {task.description}
                </p>
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
  { name: 'CheckCircle2', icon: CheckCircle2, category: 'Interface', keywords: 'done success complete' },
  { name: 'Clipboard', icon: Clipboard, category: 'Files', keywords: 'copy tasks notes' },
  { name: 'Cloud', icon: Cloud, category: 'Files', keywords: 'upload storage online' },
  { name: 'Code2', icon: Code2, category: 'Interface', keywords: 'developer brackets programming' },
  { name: 'Copy', icon: Copy, category: 'Interface', keywords: 'duplicate clone paste' },
  { name: 'CreditCard', icon: CreditCard, category: 'Interface', keywords: 'payment billing finance' },
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
  { name: 'MessageCircle', icon: MessageCircle, category: 'Communication', keywords: 'chat comment talk' },
  { name: 'Package', icon: Package, category: 'Files', keywords: 'delivery shipment box' },
  { name: 'Pencil', icon: Pencil, category: 'Interface', keywords: 'edit write compose' },
  { name: 'Phone', icon: Phone, category: 'Communication', keywords: 'call contact' },
  { name: 'Play', icon: Play, category: 'Media', keywords: 'start video audio' },
  { name: 'Search', icon: Search, category: 'Interface', keywords: 'find query' },
  { name: 'Send', icon: Send, category: 'Communication', keywords: 'share submit message' },
  { name: 'Settings2', icon: Settings2, category: 'Interface', keywords: 'preferences configure' },
  { name: 'ShieldCheck', icon: ShieldCheck, category: 'Interface', keywords: 'security verified safe' },
  { name: 'ShoppingCart', icon: ShoppingCart, category: 'Interface', keywords: 'store checkout buy' },
  { name: 'Sparkles', icon: Sparkles, category: 'Interface', keywords: 'magic ai new' },
  { name: 'Star', icon: Star, category: 'Interface', keywords: 'favorite rating featured' },
  { name: 'Tag', icon: Tag, category: 'Interface', keywords: 'label category metadata' },
  { name: 'Trash2', icon: Trash2, category: 'Interface', keywords: 'delete remove discard' },
  { name: 'TriangleAlert', icon: TriangleAlert, category: 'Interface', keywords: 'warning danger error' },
  { name: 'Upload', icon: Upload, category: 'Arrows', keywords: 'import add file' },
  { name: 'User', icon: User, category: 'People', keywords: 'account profile person' },
  { name: 'Users', icon: Users, category: 'People', keywords: 'team group members' },
  { name: 'Video', icon: Video, category: 'Media', keywords: 'camera recording meeting' },
  { name: 'WandSparkles', icon: WandSparkles, category: 'Interface', keywords: 'magic ai automate' },
  { name: 'X', icon: X, category: 'Interface', keywords: 'close cancel remove' },
  { name: 'Zap', icon: Zap, category: 'Interface', keywords: 'bolt energy fast' },
];

const iconCategories = ['All', 'Interface', 'Arrows', 'Communication', 'Files', 'People', 'Media'] as const;

function IconsView() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof iconCategories)[number]>('All');
  const [selectedName, setSelectedName] = useState('Sparkles');
  const [copied, setCopied] = useState('');

  const visibleIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return iconEntries.filter((entry) => {
      const matchesCategory = category === 'All' || entry.category === category;
      const matchesQuery =
        !normalizedQuery ||
        `${entry.name} ${entry.category} ${entry.keywords}`.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  const selectedEntry = iconEntries.find((entry) => entry.name === selectedName) ?? iconEntries[0];
  const SelectedIcon = selectedEntry.icon;

  async function copyValue(value: string, key: string) {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(''), 1600);
  }

  return (
    <>
      <PageHeading
        eyebrow="Design system"
        title="Icons"
        description="Browse a curated Lucide set, preview icons in context, and copy imports into your module."
        action={
          <Badge variant="outline" className="w-fit gap-1.5">
            <Shapes className="size-3.5" />
            {iconEntries.length} curated
          </Badge>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <CardTitle>Lucide icons</CardTitle>
                <CardDescription>Open-source SVG icons with consistent 24px geometry.</CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <Input
                  id="icon-search"
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search icons"
                  aria-label="Search Lucide icons"
                />
              </div>
            </div>
            <Tabs value={category} onValueChange={(value) => setCategory(value as (typeof iconCategories)[number])}>
              <TabsList className="mt-3 max-w-full overflow-x-auto">
                {iconCategories.map((item) => (
                  <TabsTrigger key={item} value={item}>
                    {item}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>{visibleIcons.length} icons shown</span>
              {query && <span>Matching “{query}”</span>}
            </div>
            {visibleIcons.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visibleIcons.map((entry) => {
                  const Icon = entry.icon;
                  const isSelected = selectedEntry.name === entry.name;
                  return (
                    <div
                      key={entry.name}
                      role="button"
                      tabIndex={0}
                      className={`group rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 ${
                        isSelected ? 'border-primary bg-accent/40' : 'bg-card'
                      }`}
                      onClick={() => setSelectedName(entry.name)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedName(entry.name);
                        }
                      }}
                    >
                      <div className="flex h-20 items-center justify-center rounded-lg bg-muted/45 text-foreground">
                        <Icon className="size-8 stroke-[1.5]" />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{entry.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 opacity-60 group-hover:opacity-100"
                          aria-label={`Copy ${entry.name} import`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyValue(`import { ${entry.name} } from 'lucide-react';`, entry.name);
                          }}
                        >
                          {copied === entry.name ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No Lucide icons match your search.
              </div>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SelectedIcon className="size-4 text-primary" />
                {selectedEntry.name}
              </CardTitle>
              <CardDescription>{selectedEntry.category} icon preview</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex min-h-36 items-center justify-center rounded-xl border bg-muted/30">
                <SelectedIcon className="size-14 stroke-[1.25]" />
              </div>
              <code className="mt-4 block overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {`<${selectedEntry.name} className="size-5" />`}
              </code>
              <Button
                variant="outline"
                className="mt-3 w-full gap-2"
                onClick={() =>
                  void copyValue(`import { ${selectedEntry.name} } from 'lucide-react';`, `detail-${selectedEntry.name}`)
                }
              >
                {copied === `detail-${selectedEntry.name}` ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === `detail-${selectedEntry.name}` ? 'Copied import' : 'Copy import'}
              </Button>
            </CardContent>
          </Card>
          <Card className="border-primary/20 bg-primary/[0.03]">
            <CardHeader>
              <CardTitle className="text-base">Next icon sets</CardTitle>
              <CardDescription>Good additions for different product surfaces.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div>
                <p className="font-medium">Phosphor Icons</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Six weights make it strong for marketing pages and expressive product states.
                </p>
              </div>
              <div>
                <p className="font-medium">Tabler Icons</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Broad UI coverage with a familiar outline style and generous customization.
                </p>
              </div>
              <div>
                <p className="font-medium">Heroicons</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Tight Tailwind pairing with outline and solid variants for app navigation.
                </p>
              </div>
              <div>
                <p className="font-medium">Material Symbols</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Variable optical weight and fill make it useful for dense admin tools.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
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
            <CardContent className="flex min-h-32 items-center p-5">
              <ComponentPreview name={name} userInitials={userInitials} userName={userName} />
            </CardContent>
          </Card>
        ))}
      </div>
      <section className="mt-12 space-y-5">
        <PageHeading
          eyebrow="Slopstack runtime"
          title="Application primitives"
          description="Typed building blocks for composing app data, screens, interactions, discovery, and backend extensions. Status marks what is ready, partial, contract-only, or planned."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {primitiveCatalog.primitives.map((primitive) => (
            <Card key={primitive.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{primitive.id}</CardTitle>
                  <Badge variant={primitive.status === 'implemented' ? 'secondary' : 'outline'}>{primitive.status}</Badge>
                </div>
                <CardDescription>{primitive.category}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{primitive.purpose}</p>
                {'runtime' in primitive && primitive.runtime && <code className="block truncate text-xs">{primitive.runtime}</code>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <AdvancedPatternsShowcase />
    </>
  );
}

function AdvancedPatternsShowcase() {
  const [mediaOpen, setMediaOpen] = useState(false);
  const [feedItems, setFeedItems] = useState(['Activity 1', 'Activity 2', 'Activity 3']);
  const [comments, setComments] = useState<ThreadComment[]>([
    { id: 'comment-1', author: 'Taylor', body: 'These composed patterns are ready to adapt to app data.' },
    { id: 'comment-2', author: 'Jordan', body: 'They keep loading, empty, and reply behavior consistent.', parentId: 'comment-1' },
  ]);
  const collections = [
    { id: '1', title: 'Plan', group: 'Today' },
    { id: '2', title: 'Review', group: 'Today' },
    { id: '3', title: 'Ship', group: 'Tomorrow' },
  ];
  const previewImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="100%" height="100%" fill="#e9e7ff"/><circle cx="400" cy="240" r="88" fill="#7163e8"/><path d="M380 190v100l84-50z" fill="white"/></svg>')}`;
  return (
    <section className="mt-12 space-y-5">
      <PageHeading eyebrow="Composed UI" title="Application patterns" description="Layouts, feeds, collections, empty/loading states, comments, media, and dashboard widgets built on the shadcn primitives." />
      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardWidget title="Dashboard widget" description="A reusable card with an application-owned renderer.">
          <div className="grid grid-cols-3 gap-3 text-center"><div><p className="text-2xl font-semibold">12</p><p className="text-xs text-muted-foreground">Open</p></div><div><p className="text-2xl font-semibold">8</p><p className="text-xs text-muted-foreground">Done</p></div><div><p className="text-2xl font-semibold">3</p><p className="text-xs text-muted-foreground">Groups</p></div></div>
        </DashboardWidget>
        <DashboardWidget title="Collection and states" description="Group ordered items and standardize empty/loading feedback.">
          <CollectionView items={collections} getKey={(item) => item.id} groupBy={(item) => item.group} renderItem={(item) => <div className="rounded-md border bg-background px-3 py-2 text-sm">{item.title}</div>} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><EmptyState title="No saved searches" description="Save a query to find it again." /><LoadingState label="Loading examples" rows={1} /></div>
        </DashboardWidget>
        <DashboardWidget title="Comment thread" description="A small threaded discussion with reply submission.">
          <CommentThread comments={comments} currentUser="Alex" onSubmit={(body, parentId) => setComments((current) => [...current, { id: `comment-${current.length + 1}`, author: 'Alex', body, parentId }])} />
        </DashboardWidget>
        <DashboardWidget title="Media viewer" description="Accessible image, video, and audio presentation in a dialog.">
          <div className="grid gap-3"><img src={previewImage} alt="Abstract sample media" className="max-h-48 w-full rounded-md object-cover" /><Button className="w-fit" onClick={() => setMediaOpen(true)}>Open media viewer</Button></div>
          <MediaViewer open={mediaOpen} onOpenChange={setMediaOpen} title="Sample media" src={previewImage} kind="image" alt="Abstract purple play button illustration" />
        </DashboardWidget>
        <DashboardWidget title="Feed and master-detail layouts" description="Responsive data arrangements for navigation-heavy screens.">
          <FeedLayout columns="two"><div className="rounded-md border p-3 text-sm">Feed column</div><div className="rounded-md border p-3 text-sm">Context panel</div></FeedLayout>
          <div className="mt-4"><MasterDetailLayout master={<ul className="space-y-2 text-sm"><li>Inbox</li><li>Drafts</li></ul>} detail={<p className="text-sm">Selected section content.</p>} /></div>
          <div className="mt-4"><InfiniteFeed items={feedItems} getKey={(item) => item} hasMore={feedItems.length < 6} loading={false} onLoadMore={() => setFeedItems((current) => [...current, ...current.map((_, index) => `Activity ${current.length + index + 1}`)].slice(0, 6))} renderItem={(item) => <div className="border-b py-2 text-sm">{item}</div>} /></div>
        </DashboardWidget>
      </div>
    </section>
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
            <div className="p-4 text-sm text-muted-foreground">
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
            <div className="rounded-lg border bg-muted/30 p-4">
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

function SettingsView() {
  const { setTheme } = useTheme();
  const [notifications, setNotifications] = useState({ daily: true, event: true, team: true });
  const [mobilePush, setMobilePush] = useState(true);
  const [desktop, setDesktop] = useState(true);
  const [email, setEmail] = useState(false);
  const [twoFactor, setTwoFactor] = useState(true);
  const [preferences, setPreferences] = useState<UserPreferences>({
    locale: 'en-US', timeZone: 'UTC', dateFormat: 'MMM d, yyyy', timeFormat: '12h', theme: 'light', navigation: 'sidebar',
    themeTokens: { primary: '#007acc', accent: '#dbeeff', radius: '0.75rem' },
    motion: { style: 'scale', duration: 'normal', easing: 'standard' },
  });
  const [preferencesError, setPreferencesError] = useState('');

  useEffect(() => {
    let active = true;
    getPreferences().then((saved) => { if (active) setPreferences(saved); }).catch(() => {
      if (active) setPreferencesError('Could not load saved preferences.');
    });
    return () => { active = false; };
  }, []);

  function updatePreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    const patch = { [key]: value } as UserPreferencesPatchInputBodyWritable;
    setPreferences((current) => ({ ...current, [key]: value }));
    setPreferencesError('');
    if (key === 'theme') setTheme(String(value));
    void savePreferences(patch).then((saved) => {
      setPreferences(saved);
      const userId = pb.authStore.record?.id;
      if (userId) localStorage.setItem(`slopstack.preferences.${userId}`, JSON.stringify(saved));
      applyThemeTokens(saved.themeTokens);
      applyMotionPreferences(saved.motion);
      window.dispatchEvent(new CustomEvent('slopstack:preferences', { detail: saved }));
    }).catch(() => setPreferencesError('Could not save this preference.'));
  }

  function setNotification(key: keyof typeof notifications, checked: boolean) {
    setNotifications((current) => ({ ...current, [key]: checked }));
  }

  return (
    <div className="min-w-0">
      <div className="mx-auto max-w-[1080px]">
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

        <div className="mt-10">
          <SettingsSectionTitle title="My Settings" />
          <div className="grid gap-6">
                <SettingsSelectRow
                  label="Appearance"
                  description="Choose the color theme for this account."
                  value={preferences.theme}
                  options={['light', 'dark', 'system']}
                  onChange={(value) => updatePreference('theme', value)}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>Primary theme token</span>
                    <input aria-label="Primary theme color" type="color" value={preferences.themeTokens.primary} onChange={(event) => updatePreference('themeTokens', { ...preferences.themeTokens, primary: event.target.value })} />
                  </label>
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>Accent theme token</span>
                    <input aria-label="Accent theme color" type="color" value={preferences.themeTokens.accent} onChange={(event) => updatePreference('themeTokens', { ...preferences.themeTokens, accent: event.target.value })} />
                  </label>
                </div>
                <SettingsSelectRow
                  label="Corner radius"
                  description="Customize the shape of buttons, cards, and controls."
                  value={preferences.themeTokens.radius}
                  options={['0.5rem', '0.75rem', '1rem']}
                  onChange={(value) => updatePreference('themeTokens', { ...preferences.themeTokens, radius: value })}
                />
                <SettingsSwitchRow
                  label="Two-factor authentication"
                  description="Keep your account secure by enabling 2FA via SMS or using a temporary one-time passcode (TOTP)."
                  checked={twoFactor}
                  onCheckedChange={setTwoFactor}
                />
                <SettingsSelectRow
                  label="Locale"
                  description="Use this locale for dates, numbers, and future translated UI."
                  value={preferences.locale}
                  options={['en-US', 'en-GB', 'es-ES', 'fr-FR']}
                  onChange={(value) => updatePreference('locale', value)}
                />
                <SettingsSelectRow
                  label="Time zone"
                  description="Use an IANA time zone for date and time display."
                  value={preferences.timeZone}
                  options={['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo']}
                  onChange={(value) => updatePreference('timeZone', value)}
                />
                <SettingsSelectRow
                  label="Date format"
                  description="Choose how dates appear across the app."
                  value={preferences.dateFormat}
                  options={['MMM d, yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy']}
                  onChange={(value) => updatePreference('dateFormat', value)}
                />
                <SettingsSelectRow
                  label="Time format"
                  description="Choose between 12-hour and 24-hour time."
                  value={preferences.timeFormat}
                  options={['12h', '24h']}
                  onChange={(value) => updatePreference('timeFormat', value)}
                />
                <SettingsSelectRow
                  label="Navigation layout"
                  description="Select the navigation pattern for this app."
                  value={preferences.navigation}
                  options={['sidebar', 'topbar', 'rail', 'bottom']}
                  onChange={(value) => updatePreference('navigation', value)}
                />
                <SettingsSelectRow
                  label="Component opening and closing"
                  description="Set the animation style for dialogs, menus, and popovers. Reduced-motion system settings are always respected."
                  value={preferences.motion.style}
                  options={['fade', 'scale', 'slide', 'none']}
                  onChange={(value) => updatePreference('motion', { ...preferences.motion, style: value })}
                />
                <SettingsSelectRow
                  label="Animation speed"
                  description="Choose how quickly interface components open and close."
                  value={preferences.motion.duration}
                  options={['fast', 'normal', 'slow']}
                  onChange={(value) => updatePreference('motion', { ...preferences.motion, duration: value })}
                />
                <SettingsSelectRow
                  label="Animation easing"
                  description="Choose the timing curve used by component transitions."
                  value={preferences.motion.easing}
                  options={['standard', 'smooth', 'snappy']}
                  onChange={(value) => updatePreference('motion', { ...preferences.motion, easing: value })}
                />
                {preferencesError && <p className="text-sm text-destructive" role="alert">{preferencesError}</p>}
              </div>
            </div>
      </div>
      </div>
  );
}

function SidebarTools() {
  return (
    <div className="mt-8 flex items-center gap-2 px-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input className="h-9 w-full pl-8" placeholder="Search" aria-label="Search" />
      </div>
      <Button variant="outline" size="icon-sm" aria-label="Notifications">
        <Bell className="size-4" />
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
          className="h-10 min-w-28 appearance-none rounded-xl border-0 bg-muted py-1.5 pr-9 pl-3 text-[16px] text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
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

