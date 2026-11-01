#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(readFileSync(new URL('./registry.json', import.meta.url), 'utf8'));

function usage() {
  console.log(`Slopstack primitive tools

  node packages/cli/slopstack.mjs list [--json]
  node packages/cli/slopstack.mjs generate resource <name> [--field <name>:<kind>]...
  node packages/cli/slopstack.mjs generate view <name>
  node packages/cli/slopstack.mjs generate layout <name>
  node packages/cli/slopstack.mjs generate backend-plugin <name>

  Kinds: text, number, boolean, select, relation, date, datetime, time, slider, file
  Options: --out <directory> (default: apps/web/src), --force
`);
}

function pascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

function camelCase(value) {
  const name = pascalCase(value);
  return name ? name[0].toLowerCase() + name.slice(1) : '';
}

function slug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseArgs(args) {
  const options = { fields: [], output: undefined, force: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--field') options.fields.push(args[++i] ?? '');
    else if (args[i] === '--out') options.output = args[++i] ?? '';
    else if (args[i] === '--force') options.force = true;
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  return options;
}

function fieldSource(field) {
  const [name, kind, ...configuration] = field.split(':');
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name ?? '')) throw new Error(`Invalid field name: ${name}`);
  const supported = new Set([
    'text',
    'number',
    'boolean',
    'select',
    'relation',
    'date',
    'datetime',
    'time',
    'slider',
    'file',
  ]);
  if (!supported.has(kind)) throw new Error(`Unsupported field kind "${kind}" for ${name}.`);
  const label = name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  let definition = `{ name: '${name}', label: '${label}', kind: '${kind}'`;
  if (kind === 'slider') {
    const [min = '0', max = '100', step = '1'] = configuration.join(':').split(',');
    if (![min, max, step].every((value) => /^-?\d+(\.\d+)?$/.test(value)))
      throw new Error(`Invalid slider range for ${name}; use name:slider:min,max,step.`);
    definition += `, min: ${min}, max: ${max}, step: ${step}`;
  }
  if (kind === 'select') {
    const options = configuration.join(':').split(',').filter(Boolean);
    if (!options.length || options.some((value) => !/^[A-Za-z0-9_-]+$/.test(value)))
      throw new Error(`Invalid select options for ${name}; use name:select:value1,value2.`);
    definition += `, options: [${options.map((value) => `{ label: '${value.replaceAll('_', ' ')}', value: '${value}' }`).join(', ')}]`;
  }
  if (kind === 'relation') {
    const [resource, cardinality = 'one'] = configuration;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(resource ?? '') || !['one', 'many'].includes(cardinality))
      throw new Error(`Invalid relationship for ${name}; use name:relation:resource:one|many.`);
    definition += `, resource: '${resource}', cardinality: '${cardinality}'`;
  }
  if (kind === 'text' && configuration[0] === 'multiline') definition += ', multiline: true, rows: 3';
  return `${definition} }`;
}

function render(kind, name, fields = []) {
  const id = slug(name);
  const symbol = pascalCase(name);
  const variable = camelCase(name);
  if (!id || !symbol) throw new Error('Choose a name with letters or numbers.');
  if (kind === 'backend-plugin' && !/^[a-z]/.test(id))
    throw new Error('Backend plugin names must start with a letter.');
  if (kind === 'resource') {
    const fieldList = fields.length
      ? fields
          .map(fieldSource)
          .map((field) => `    ${field},`)
          .join('\n')
      : "    { name: 'name', label: 'Name', kind: 'text', required: true },";
    return {
      directory: 'resources',
      file: `${id}.ts`,
      source: `import { defineResource } from '@/lib/slopstack';\n\nexport const ${variable}Resource = defineResource({\n  id: '${id}',\n  label: '${symbol}',\n  labelPlural: '${symbol.endsWith('s') ? symbol : `${symbol}s`}',\n  source: { kind: 'pocketbase', collection: '${id}' },\n  fields: [\n${fieldList}\n  ],\n  operations: { list: true, get: true, create: true, update: true, delete: true },\n  permissions: {\n    list: { authenticated: true },\n    get: { authenticated: true },\n    create: { authenticated: true },\n    update: { authenticated: true },\n    delete: { authenticated: true },\n  },\n  query: { pageSize: 25 },\n});\n`,
    };
  }
  if (kind === 'view') {
    return {
      directory: 'views',
      file: `${id}-view.tsx`,
      source: `import type { ViewDefinition } from '@/lib/slopstack';\n\nexport const ${variable}View: ViewDefinition = {\n  id: '${id}',\n  path: '/${id}',\n  label: '${symbol}',\n  component: function ${symbol}View({ context }) {\n    return (\n      <section className="space-y-4">\n        <h1 className="text-2xl font-semibold">${symbol}</h1>\n        <p className="text-muted-foreground">Build this view. Route: {context.params['*'] ?? 'home'}.</p>\n      </section>\n    );\n  },\n};\n`,
    };
  }
  if (kind === 'layout') {
    return {
      directory: 'layouts',
      file: `${id}-layout.tsx`,
      source: `import type { LayoutDefinition } from '@/lib/slopstack';\n\nexport const ${variable}Layout: LayoutDefinition = {\n  id: '${id}',\n  label: '${symbol}',\n  slots: [\n    { id: 'header', label: 'Header', accepts: ['component', 'action'] },\n    { id: 'main', label: 'Main content', accepts: ['view', 'component', 'resource'], required: true },\n    { id: 'aside', label: 'Aside', accepts: ['view', 'component', 'resource'] },\n  ],\n  component: ({ slots }) => (\n    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">\n      <main className="min-w-0 space-y-6">{slots.header}{slots.main}</main>\n      <aside>{slots.aside}</aside>\n    </div>\n  ),\n};\n`,
    };
  }
  if (kind === 'backend-plugin') {
    const packageName = id.replaceAll('-', '_');
    return {
      directory: path.join('plugins', id),
      file: 'plugin.go',
      source: `package ${packageName}

import "github.com/slopstack/slopstack/apps/server/internal/primitives"

// Definition returns the backend extension contract. Register it from the app composition point.
func Definition() primitives.BackendPlugin {
	return primitives.BackendPlugin{
		Name:        "${id.replaceAll('-', '_')}",
		Description: "${symbol} backend extension",
		Collections: []primitives.CollectionDefinition{},
		Endpoints:   []primitives.Endpoint{},
		Hooks:       []primitives.Hook{},
		Jobs:        []primitives.Job{},
	}
}
`,
    };
  }
  throw new Error(`Unsupported generator: ${kind}`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'list') {
    console.log(
      args.includes('--json')
        ? JSON.stringify(registry, null, 2)
        : registry.primitives
            .map(
              (item) =>
                `${item.id.padEnd(22)} ${(item.status ?? 'planned').padEnd(11)} ${item.purpose}`,
            )
            .join('\n'),
    );
    return;
  }
  if (command !== 'generate') return usage();
  const [kind, name, ...rawOptions] = args;
  if (!['resource', 'view', 'layout', 'backend-plugin'].includes(kind))
    throw new Error('Generate resource, view, layout, or backend-plugin.');
  if (!name) throw new Error('Provide a name for the primitive.');
  const options = parseArgs(rawOptions);
  const rendered = render(kind, name, options.fields);
  const defaultOutput = kind === 'backend-plugin' ? 'apps/server/internal' : 'apps/web/src';
  const targetRoot = path.resolve(root, options.output ?? defaultOutput);
  const destination = path.resolve(targetRoot, rendered.directory, rendered.file);
  if (!destination.startsWith(`${targetRoot}${path.sep}`))
    throw new Error('Output path escapes the selected directory.');
  if (existsSync(destination) && !options.force)
    throw new Error(`${path.relative(root, destination)} exists. Use --force to replace it.`);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, rendered.source);
  console.log(`Generated ${kind}: ${path.relative(root, destination)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
