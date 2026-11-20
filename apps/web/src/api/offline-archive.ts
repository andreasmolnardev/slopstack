import type { LearningRecord } from './learning-queries';
import { MAX_OFFLINE_NARRATION_BYTES, type OfflineLearningStore, type SavedCourseProgress } from './offline-learning';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const FORMAT = 'starburst-offline-library';

type OfflineArchive = {
  format: typeof FORMAT;
  version: 1;
  courses: Array<{ course: LearningRecord; downloadedAt: number; progress?: SavedCourseProgress; narration?: string[] }>;
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function exportOfflineLibrary(ownerId: string, store: OfflineLearningStore): Promise<Blob> {
  const downloads = await store.listCourses(ownerId);
  const courses: OfflineArchive['courses'] = [];
  let mediaBytes = 0;
  for (const download of downloads) {
    const progress = await store.getSavedProgress(ownerId, download.course.id);
    const version = Number(download.course.version ?? 1);
    const blobs = await store.getNarrationAssets(ownerId, download.course.id, version);
    const narration = blobs?.map(blob => {
      mediaBytes += blob.size;
      if (mediaBytes > MAX_ARCHIVE_BYTES || blob.size > MAX_OFFLINE_NARRATION_BYTES) throw new Error('Offline archive exceeds its media size limit');
      return encodeBase64(new Uint8Array());
    });
    if (narration && blobs) {
      for (let index = 0; index < narration.length; index += 1) narration[index] = encodeBase64(new Uint8Array(await blobs[index].arrayBuffer()));
    }
    courses.push({ course: download.course, downloadedAt: download.downloadedAt, progress, narration });
  }
  const archive: OfflineArchive = { format: FORMAT, version: 1, courses };
  const blob = new Blob([JSON.stringify(archive)], { type: 'application/vnd.starburst.offline+json' });
  if (blob.size > MAX_ARCHIVE_BYTES) throw new Error('Offline archive exceeds the 100 MiB limit');
  return blob;
}

export async function importOfflineLibrary(ownerId: string, file: File, store: OfflineLearningStore): Promise<number> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Offline archive exceeds the 100 MiB limit');
  const value: unknown = JSON.parse(await file.text());
  if (!value || typeof value !== 'object' || (value as OfflineArchive).format !== FORMAT || (value as OfflineArchive).version !== 1 || !Array.isArray((value as OfflineArchive).courses)) {
    throw new Error('Unsupported offline library archive');
  }
  const courses = (value as OfflineArchive).courses;
  if (courses.length > 1000) throw new Error('Offline archive contains too many courses');
  let mediaBytes = 0;
  const prepared = courses.map(entry => {
    if (!entry || typeof entry !== 'object' || !entry.course || typeof entry.course.id !== 'string' || !entry.course.id || !Array.isArray(entry.narration ?? [])) {
      throw new Error('Offline archive contains an invalid course');
    }
    const blobs = (entry.narration ?? []).map(encoded => {
      if (typeof encoded !== 'string') throw new Error('Offline archive contains invalid narration');
      const bytes = decodeBase64(encoded);
      mediaBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_OFFLINE_NARRATION_BYTES || mediaBytes > MAX_ARCHIVE_BYTES) throw new Error('Offline archive exceeds its media size limit');
      return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'audio/wav' });
    });
    const progress = entry.progress;
    if (progress && (!Number.isInteger(progress.sceneIndex) || progress.sceneIndex < 0 || !Number.isFinite(progress.positionSeconds) || progress.positionSeconds < 0 || typeof progress.completed !== 'boolean')) {
      throw new Error('Offline archive contains invalid resume progress');
    }
    return { course: entry.course, progress, blobs };
  });
  for (const entry of prepared) {
    await store.saveCourse(ownerId, entry.course, entry.progress);
    if (entry.blobs.length) await store.saveNarrationAssets(ownerId, entry.course.id, Number(entry.course.version ?? 1), entry.blobs);
  }
  return prepared.length;
}
