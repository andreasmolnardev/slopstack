import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { validateResourceInput } from './resource-validation';
import type { FieldDefinition, ResourceDefinition } from './types';

export type RelationOption = { id: string; label: string };
export type ResourceFormValues = Record<string, unknown>;
type ResourceFormDefinition = Omit<ResourceDefinition, 'identify' | 'types'>;

function getDefaults(resource: ResourceFormDefinition, initialValues?: ResourceFormValues) {
  const values: ResourceFormValues = {};
  for (const field of resource.fields) {
    const fallback = field.kind === 'boolean' ? false
      : (field.kind === 'relation' && field.cardinality === 'many') || (field.kind === 'select' && field.multiple) || (field.kind === 'file' && field.multiple) ? []
        : '';
    values[field.name] = initialValues?.[field.name] ?? field.defaultValue ?? fallback;
  }
  return values;
}

export function ResourceForm({
  resource,
  initialValues,
  relationOptions = {},
  submitLabel = 'Save',
  onSubmit,
  onError,
}: {
  resource: ResourceFormDefinition;
  initialValues?: ResourceFormValues;
  relationOptions?: Readonly<Record<string, readonly RelationOption[]>>;
  submitLabel?: string;
  onSubmit: (values: ResourceFormValues) => void | Promise<void>;
  onError?: (error: unknown) => void;
}) {
  const [values, setValues] = useState(() => getDefaults(resource, initialValues));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const setValue = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: '' }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = validateResourceInput(resource, values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit(values);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not save these changes.');
      onError?.(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <div className="grid gap-5 md:grid-cols-2">
        {resource.fields.filter((field) => !field.hidden).map((field) => (
          <ResourceField
            key={field.name}
            field={field}
            value={values[field.name]}
            error={errors[field.name]}
            options={field.kind === 'relation' ? relationOptions[field.resource] : undefined}
            disabled={Boolean(field.readOnly || submitting)}
            setValue={(value) => setValue(field.name, value)}
          />
        ))}
      </div>
      {submitError && <p className="text-sm text-destructive" role="alert">{submitError}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function ResourceField({
  field,
  value,
  error,
  options = [],
  disabled,
  setValue,
}: {
  field: FieldDefinition;
  value: unknown;
  error?: string;
  options?: readonly RelationOption[];
  disabled: boolean;
  setValue: (value: unknown) => void;
}) {
  const id = `resource-field-${field.name}`;
  const describedBy = [field.description ? `${id}-description` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  let control;

  switch (field.kind) {
    case 'boolean':
      control = (
        <div className="flex min-h-9 items-center gap-2">
          <Checkbox id={id} checked={Boolean(value)} disabled={disabled} onCheckedChange={(checked) => setValue(checked === true)} />
          <Label htmlFor={id}>{field.label}</Label>
        </div>
      );
      break;
    case 'select':
      control = field.multiple ? (
        <select
          id={id}
          className="min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={(Array.isArray(value) ? value : []) as string[]}
          multiple
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => setValue(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
        >
          {field.options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </select>
      ) : (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={setValue} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'slider':
      control = (
        <div className="flex items-center gap-4">
          <Slider min={field.min} max={field.max} step={field.step ?? 1} value={[typeof value === 'number' ? value : field.min]} disabled={disabled} onValueChange={(next) => setValue(next[0])} />
          <output className="min-w-10 text-right text-sm tabular-nums">{String(value ?? field.min)}</output>
        </div>
      );
      break;
    case 'relation':
      control = options.length ? (
        <select
          id={id}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={field.cardinality === 'many' ? (Array.isArray(value) ? value : []) as string[] : typeof value === 'string' ? value : ''}
          multiple={field.cardinality === 'many'}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => setValue(field.cardinality === 'many' ? Array.from(event.currentTarget.selectedOptions, (option) => option.value) : event.currentTarget.value)}
        >
          {field.cardinality === 'one' && <option value="">Select {field.label.toLowerCase()}</option>}
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      ) : (
        <Input id={id} value={typeof value === 'string' ? value : ''} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => setValue(event.target.value)} />
      );
      break;
    case 'file':
      control = (
        <Input
          id={id}
          type="file"
          multiple={field.multiple}
          accept={field.accept?.join(',')}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setValue(field.multiple ? files : files[0] ?? null);
          }}
        />
      );
      break;
    case 'date':
    case 'datetime':
    case 'time':
    case 'number':
      control = (
        <Input
          id={id}
          type={field.kind === 'datetime' ? 'datetime-local' : field.kind}
          value={String(value ?? '')}
          min={field.min}
          max={field.max}
          step={field.kind === 'number' ? field.step : undefined}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => setValue(field.kind === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
        />
      );
      break;
    case 'text':
      control = field.multiline ? (
        <Textarea id={id} rows={field.rows} value={String(value ?? '')} maxLength={field.maxLength} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => setValue(event.target.value)} />
      ) : (
        <Input id={id} type={field.inputType ?? 'text'} value={String(value ?? '')} minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => setValue(event.target.value)} />
      );
      break;
  }

  return (
    <div className="grid gap-2">
      {field.kind !== 'boolean' && <Label htmlFor={id}>{field.label}{field.required ? ' *' : ''}</Label>}
      {control}
      {field.description && <p id={`${id}-description`} className="text-xs text-muted-foreground">{field.description}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
