import type { UserPreferences, UserPreferencesPatchInputBodyWritable } from '../api/generated/types.gen';

export type LearnerProfileForm = {
  learningInterests: string;
  learningGoals: string;
  priorKnowledge: string;
  preferredLanguage: string;
  defaultDifficulty: string;
  targetMinutes: number;
  narration: boolean;
  captions: boolean;
  narrationVoice: string;
  narrationSpeaker: string;
};

export function learnerProfileForm(preferences: UserPreferences): LearnerProfileForm {
  return {
    learningInterests: listToText(preferences.learningInterests),
    learningGoals: listToText(preferences.learningGoals),
    priorKnowledge: listToText(preferences.priorKnowledge),
    preferredLanguage: preferences.preferredLanguage,
    defaultDifficulty: preferences.defaultDifficulty,
    targetMinutes: preferences.targetMinutes,
    narration: preferences.narration,
    captions: preferences.captions,
    narrationVoice: preferences.narrationVoice ?? '',
    narrationSpeaker: preferences.narrationSpeaker ?? '',
  };
}

export function listToText(values: string[] | null | undefined): string {
  return (values ?? []).join('\n');
}

export function parseProfileList(text: string): string[] {
  const values = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (values.length > 20) throw new Error('Enter no more than 20 items in each list.');
  if (values.some(value => [...value].length > 100)) throw new Error('Each item must be 100 characters or fewer.');
  return values;
}

export function learnerProfilePatch(form: LearnerProfileForm): UserPreferencesPatchInputBodyWritable {
  if (!Number.isInteger(form.targetMinutes) || form.targetMinutes < 5 || form.targetMinutes > 60) {
    throw new Error('Target lesson time must be between 5 and 60 minutes.');
  }
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(form.preferredLanguage.trim())) {
    throw new Error('Enter a valid language tag, such as en or fr-CA.');
  }
  if (!['beginner', 'intermediate', 'advanced'].includes(form.defaultDifficulty)) {
    throw new Error('Choose a supported difficulty.');
  }
  return {
    learningInterests: parseProfileList(form.learningInterests),
    learningGoals: parseProfileList(form.learningGoals),
    priorKnowledge: parseProfileList(form.priorKnowledge),
    preferredLanguage: form.preferredLanguage.trim(),
    defaultDifficulty: form.defaultDifficulty,
    targetMinutes: form.targetMinutes,
    narration: form.narration,
    captions: form.captions,
    narrationVoice: form.narrationVoice.trim(),
    narrationSpeaker: form.narrationSpeaker.trim(),
  };
}
