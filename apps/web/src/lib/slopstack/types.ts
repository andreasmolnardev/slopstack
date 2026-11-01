import type { ComponentType, ReactNode } from 'react';

export type SlopstackId = string;

export type PermissionRequirement = {
  authenticated?: boolean;
  permission?: string;
  roles?: readonly string[];
};

export type TextField = FieldBase<string, 'text'> & {
  inputType?: 'text' | 'email' | 'password' | 'url' | 'tel';
  multiline?: boolean;
  rows?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type NumberField = FieldBase<number, 'number'> & {
  min?: number;
  max?: number;
  step?: number;
};

export type BooleanField = FieldBase<boolean, 'boolean'>;

export type SelectField = FieldBase<string, 'select'> & {
  options: readonly { label: string; value: string; disabled?: boolean }[];
  multiple?: boolean;
};

export type DateField = FieldBase<string, 'date' | 'datetime' | 'time'> & {
  min?: string;
  max?: string;
};

export type SliderField = FieldBase<number, 'slider'> & {
  min: number;
  max: number;
  step?: number;
};

export type RelationField = FieldBase<string | readonly string[], 'relation'> & {
  resource: SlopstackId;
  cardinality: 'one' | 'many';
  displayField?: string;
};

export type FileField = FieldBase<File | string | readonly (File | string)[], 'file'> & {
  multiple?: boolean;
  maxSizeBytes?: number;
  accept?: readonly string[];
};

export type FieldDefinition =
  | TextField
  | NumberField
  | BooleanField
  | SelectField
  | DateField
  | SliderField
  | RelationField
  | FileField;

export type FieldBase<Value, Kind extends string> = {
  name: string;
  label: string;
  kind: Kind;
  description?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  defaultValue?: Value;
  validate?: (value: Value, record: unknown) => string | undefined;
};

export type ResourceSource =
  | { kind: 'pocketbase'; collection: string }
  | {
      kind: 'endpoint';
      list?: string;
      get?: string;
      create?: string;
      update?: string;
      delete?: string;
    };

export type QueryDefinition = {
  searchFields?: readonly string[];
  defaultSort?: string;
  pageSize?: number;
  filters?: readonly FilterDefinition[];
};

export type FilterDefinition = {
  id: string;
  label: string;
  field: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'greaterThan' | 'lessThan' | 'in';
  options?: readonly { label: string; value: string }[];
};

export type ResourceDefinition<
  RecordType extends object = Record<string, unknown>,
  CreateType extends object = Partial<RecordType>,
  UpdateType extends object = Partial<CreateType>,
> = {
  id: SlopstackId;
  label: string;
  labelPlural?: string;
  description?: string;
  source: ResourceSource;
  fields: readonly FieldDefinition[];
  relations?: readonly { field: string; resource: SlopstackId; cardinality: 'one' | 'many' }[];
  query?: QueryDefinition;
  permissions?: Partial<Record<'list' | 'get' | 'create' | 'update' | 'delete', PermissionRequirement>>;
  operations?: Partial<Record<'list' | 'get' | 'create' | 'update' | 'delete', boolean>>;
  identify?: (record: RecordType) => string;
  types?: { record?: RecordType; create?: CreateType; update?: UpdateType };
};

export type ViewContext = {
  params: Record<string, string>;
  search: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
};

export type ViewDefinition = {
  id: SlopstackId;
  path: string;
  label: string;
  description?: string;
  layout?: SlopstackId;
  access?: PermissionRequirement;
  component: ComponentType<{ context: ViewContext }>;
};

export type LayoutSlot = {
  id: string;
  label?: string;
  accepts?: readonly ('view' | 'component' | 'action' | 'resource')[];
  multiple?: boolean;
  required?: boolean;
};

export type LayoutDefinition = {
  id: SlopstackId;
  label: string;
  description?: string;
  slots: readonly LayoutSlot[];
  component: ComponentType<{ slots: Record<string, ReactNode> }>;
};

export type NavigationItem = {
  id: string;
  label: string;
  view: SlopstackId;
  group?: string;
  icon?: ComponentType<{ className?: string }>;
  access?: PermissionRequirement;
};

export type ShellDefinition = {
  id: SlopstackId;
  label: string;
  navigation: readonly NavigationItem[];
  navigationStyles?: readonly ('sidebar' | 'topbar' | 'rail' | 'bottom')[];
  component: ComponentType<{ children: ReactNode }>;
};

export type ActionContext<Input = unknown> = {
  input: Input;
  navigate: ViewContext['navigate'];
  notify: (notification: { title: string; description?: string; type?: 'success' | 'error' | 'info' }) => void;
};

export type ActionDefinition<Input = unknown, Output = unknown> = {
  id: SlopstackId;
  label: string;
  description?: string;
  keywords?: readonly string[];
  shortcut?: string;
  icon?: ComponentType<{ className?: string }>;
  access?: PermissionRequirement;
  confirm?: { title: string; description?: string; confirmLabel?: string; destructive?: boolean };
  execute: (context: ActionContext<Input>) => Promise<Output> | Output;
  messages?: { success?: string; error?: string };
};

export type SearchResult = {
  id: string;
  title: string;
  description?: string;
  href?: string;
  icon?: ComponentType<{ className?: string }>;
  keywords?: readonly string[];
};

export type SearchProvider = {
  id: SlopstackId;
  label: string;
  search: (query: string, signal?: AbortSignal) => Promise<readonly SearchResult[]>;
  minQueryLength?: number;
};

export type ShortcutDefinition = {
  id: SlopstackId;
  keys: readonly string[];
  label: string;
  description?: string;
  access?: PermissionRequirement;
  execute: () => void | Promise<void>;
};

export type PluginContext = {
  registerResource: (resource: ResourceDefinition) => void;
  registerView: (view: ViewDefinition) => void;
  registerLayout: (layout: LayoutDefinition) => void;
  registerAction: (action: ActionDefinition) => void;
  registerSearchProvider: (provider: SearchProvider) => void;
  registerShortcut: (shortcut: ShortcutDefinition) => void;
};

export type SlopstackPlugin = {
  id: SlopstackId;
  version: string;
  label: string;
  description?: string;
  register: (context: PluginContext) => void | (() => void);
};

export type ApplicationDefinition = {
  id: SlopstackId;
  name: string;
  shell?: ShellDefinition;
  resources?: readonly ResourceDefinition[];
  views?: readonly ViewDefinition[];
  layouts?: readonly LayoutDefinition[];
  actions?: readonly ActionDefinition[];
  searchProviders?: readonly SearchProvider[];
  shortcuts?: readonly ShortcutDefinition[];
  plugins?: readonly SlopstackPlugin[];
};
