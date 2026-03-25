import type { VrmSource } from '../types/vrm';

/**
 * Registry of available VRM model sources.
 *
 * Future control-panel: allow the teacher to switch which VRM is used
 * per participant (or globally) by selecting an entry from this registry.
 *
 * To add a new model:
 *  1. Drop the .vrm file into /public/
 *  2. Add an entry below
 *  3. It will be visible in the model-source picker automatically
 */
export const VRM_SOURCES: Record<string, VrmSource> = {
  default: {
    id: 'default',
    label: '預設角色',
    url: '/models/default.vrm',
  },
  // Example future entries:
  // teacher: {
  //   id: 'teacher',
  //   label: '教師角色',
  //   url: '/teacher.vrm',
  // },
  // student_female: {
  //   id: 'student_female',
  //   label: '女生角色',
  //   url: '/student_female.vrm',
  // },
} as const;

/** Default VRM source ID used when no preference is set */
export const DEFAULT_VRM_SOURCE_ID = 'default';
