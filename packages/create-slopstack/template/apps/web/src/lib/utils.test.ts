import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('px-2', 'text-sm')).toBe('px-2 text-sm');
  });

  it('lets later tailwind classes win', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('drops falsy values', () => {
    const hidden = false;
    expect(cn('px-2', hidden && 'hidden', undefined, null, 'text-sm')).toBe('px-2 text-sm');
  });

  it('keeps conditional classes', () => {
    const state = { active: true };
    expect(cn({ 'bg-primary': state.active, 'bg-muted': !state.active })).toBe('bg-primary');
  });
});