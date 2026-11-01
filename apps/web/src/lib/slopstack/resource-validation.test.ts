import { describe, expect, it } from 'vitest';
import { validateResourceInput } from './resource-validation';
import type { ResourceDefinition } from './types';

const resource: ResourceDefinition = {
  id: 'projects',
  label: 'Project',
  source: { kind: 'endpoint', list: '/api/projects' },
  fields: [
    { name: 'name', label: 'Name', kind: 'text', required: true, minLength: 3, maxLength: 12 },
    {
      name: 'status', label: 'Status', kind: 'select', required: true,
      options: [{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }],
    },
    { name: 'budget', label: 'Budget', kind: 'number', min: 0, max: 1000 },
  ],
};

describe('resource validation', () => {
  it('validates required, length, option, and numeric constraints', () => {
    expect(validateResourceInput(resource, { name: ' ', status: 'unknown', budget: 1001 })).toEqual({
      name: 'Name is required.',
      status: 'Status has an invalid selection.',
      budget: 'Budget must be no more than 1000.',
    });
  });

  it('accepts valid values and runs custom validation', () => {
    const withCustomValidation: ResourceDefinition = {
      ...resource,
      fields: [...resource.fields, {
        name: 'slug', label: 'Slug', kind: 'text',
        validate: (value) => value === 'reserved' ? 'This slug is reserved.' : undefined,
      }],
    };

    expect(validateResourceInput(withCustomValidation, {
      name: 'Launch Plan', status: 'active', budget: 0, slug: 'reserved',
    })).toEqual({ slug: 'This slug is reserved.' });
    expect(validateResourceInput(resource, { name: 'Launch Plan', status: 'active', budget: 0 })).toEqual({});
  });
});
