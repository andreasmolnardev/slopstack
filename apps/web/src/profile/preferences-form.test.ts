import { describe, expect, it } from 'vitest';
import type { UserPreferences } from '../api/generated/types.gen';
import { learnerProfileForm, learnerProfilePatch, listToText, parseProfileList } from './preferences-form';

const preferences: UserPreferences = {
  locale: 'en-US', timeZone: 'UTC', dateFormat: 'MMM d, yyyy', timeFormat: '12h', theme: 'light', navigation: 'sidebar',
  themeTokens: { primary: '#007acc', accent: '#dbeeff', radius: '0.75rem' }, motion: { style: 'scale', duration: 'normal', easing: 'standard' },
  learningInterests: ['astronomy'], learningGoals: ['read papers'], priorKnowledge: null,
  preferredLanguage: 'fr-CA', defaultDifficulty: 'advanced', targetMinutes: 40, narration: false, captions: true,
};

describe('learner profile preferences form helpers', () => {
  it('maps saved preferences into editable fields and handles legacy null lists', () => {
    const form = learnerProfileForm(preferences);
    expect(form.learningInterests).toBe('astronomy');
    expect(form.learningGoals).toBe('read papers');
    expect(form.priorKnowledge).toBe('');
    expect(form.narration).toBe(false);
    expect(listToText(null)).toBe('');
  });

  it('trims and omits blank list lines', () => {
    expect(parseProfileList('\n astronomy \n\nmath\n')).toEqual(['astronomy', 'math']);
  });

  it('builds only learner preference fields and checks list/target limits', () => {
    const patch = learnerProfilePatch(learnerProfileForm(preferences));
    expect(patch).toEqual({
      learningInterests: ['astronomy'], learningGoals: ['read papers'], priorKnowledge: [],
      preferredLanguage: 'fr-CA', defaultDifficulty: 'advanced', targetMinutes: 40, narration: false, captions: true,
    });
    expect(() => parseProfileList(Array.from({ length: 21 }, (_, index) => `item ${index}`).join('\n'))).toThrow('20 items');
    expect(() => learnerProfilePatch({ ...learnerProfileForm(preferences), targetMinutes: 61 })).toThrow('between 5 and 60');
  });
});
