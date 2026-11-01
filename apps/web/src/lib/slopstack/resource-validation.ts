import type { FieldDefinition, ResourceDefinition } from './types';

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

export function validateField(field: FieldDefinition, value: unknown, record: unknown): string | undefined {
  if (field.required && !hasValue(value)) return `${field.label} is required.`;
  if (!hasValue(value)) return undefined;

  if (field.kind === 'text' && typeof value === 'string') {
    if (field.minLength !== undefined && value.length < field.minLength) {
      return `${field.label} must contain at least ${field.minLength} characters.`;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return `${field.label} must contain no more than ${field.maxLength} characters.`;
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) return `${field.label} has an invalid format.`;
  }

  if ((field.kind === 'number' || field.kind === 'slider') && typeof value === 'number') {
    if (field.min !== undefined && value < field.min) return `${field.label} must be at least ${field.min}.`;
    if (field.max !== undefined && value > field.max) return `${field.label} must be no more than ${field.max}.`;
  }

  if (field.kind === 'select' && typeof value === 'string' && !field.options.some((option) => option.value === value)) {
    return `${field.label} has an invalid selection.`;
  }

  if (field.kind === 'relation') {
    const values = Array.isArray(value) ? value : [value];
    if (field.cardinality === 'one' && values.length > 1) return `${field.label} accepts one related item.`;
    if (values.some((item) => typeof item !== 'string')) return `${field.label} contains an invalid relationship.`;
  }

  const validate = field.validate as ((input: unknown, record: unknown) => string | undefined) | undefined;
  return validate?.(value, record);
}

export function validateResourceInput(
  resource: ResourceDefinition,
  values: Record<string, unknown>,
) {
  return Object.fromEntries(
    resource.fields
      .map((field) => [field.name, validateField(field, values[field.name], values)] as const)
      .filter(([, error]) => Boolean(error)),
  ) as Record<string, string>;
}
