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
 *
 * bodyType：大人模型標 'adult'，動作會優先用 public/animations/<名稱>.adult.vrma；
 * 女學生（含交換生）標 'girl'，優先用 <名稱>_f.vrma（例如 happy_f.vrma）；
 * 沒標記的當作小孩，直接用 <名稱>.vrma。
 */
export const VRM_SOURCES: Record<string, VrmSource> = {
  default: {
    id: 'default',
    label: '預設角色',
    url: '/models/Default_Female.vrm',
  },
  // teenager_female: {
  //   id: 'teenager_female',
  //   label: '少女',
  //   url: '/models/Teenager_Female.vrm',
  // },
  // teenager_male: {
  //   id: 'teenager_male',
  //   label: '少年',
  //   url: '/models/Student_Male2.vrm',
  // },
  student_female: {
    id: 'student_female',
    label: '女學生',
    url: '/models/Student_Female1.vrm',
    bodyType: 'girl',
  },
  student_female_outfit: {
    id: 'student_female_outfit',
    label: '女學生',
    url: '/models/Student_Female1_Outfit.vrm',
    bodyType: 'girl',
  },
  student_male: {
    id: 'student_male',
    label: '男學生',
    url: '/models/Student_Male1.vrm',
  },
  clothingStoreStaff_female: {
    id: 'clothingStoreStaff_female',
    label: '女店員',
    url: '/models/ClothingStoreStaff_Female.vrm',
    bodyType: 'adult',
  },
  clothingStoreStaff_male: {
    id: 'clothingStoreStaff_male',
    label: '男店員',
    url: '/models/ClothingStoreStaff_Male.vrm',
    bodyType: 'adult',
  },
  exchange_student_male: {
    id: 'exchange_student_male',
    label: '男交換生',
    url: '/models/ExchangeStudent_Male1.vrm',
  },
  exchange_student_female: {
    id: 'exchange_student_female',
    label: '女交換生',
    url: '/models/ExchangeStudent_Female1.vrm',
    // bodyType: 'girl', // 拍手用原 happy.vrma 動作較合理
  },
} as const;

/** Default VRM source ID used when no preference is set */
export const DEFAULT_VRM_SOURCE_ID = 'default';
