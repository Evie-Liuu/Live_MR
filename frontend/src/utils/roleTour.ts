/**
 * 教學模組「指定角色」：步驟由課堂實際狀態推算，不用「下一步」按鈕。
 * 老師中途關掉抽屜就回到第一步，全部指定好就完成；做法跟課堂導航相同，只讀狀態不鎖功能。
 */

export interface RoleTourInput {
  /** 角色配置抽屜是否開著 */
  panelOpen: boolean;
  /** 還沒指定演出者的角色（依抽屜裡的順序） */
  unassigned: { slotId: string; label: string }[];
  studentCount: number;
}

export type TourPlacement = 'right' | 'left' | 'below';

export interface TourStep {
  id: 'open-panel' | 'assign' | 'done';
  /** 要框起來的元素（CSS 選擇器）；null＝不框，提示放在導航列下方 */
  target: string | null;
  placement: TourPlacement;
  title: string;
  body: string;
  /** 第幾步／共幾步（完成時不顯示） */
  progress: { index: number; total: number } | null;
}

export const ROLE_TOUR_TOTAL = 2;

export function roleTourStep({ panelOpen, unassigned, studentCount }: RoleTourInput): TourStep {
  if (unassigned.length === 0) {
    return {
      id: 'done', target: null, placement: 'below', progress: null,
      title: '角色都指定好了',
      body: '大屏會顯示每個角色由誰演出。接著可以帶任務前的暖身提問。',
    };
  }
  if (!panelOpen) {
    return {
      id: 'open-panel', target: '[data-tour="role-card"]', placement: 'right', progress: { index: 1, total: ROLE_TOUR_TOTAL },
      title: '打開角色配置',
      body: '點左側的「角色」卡片，這裡列出任務需要的角色和台詞句數。',
    };
  }
  const first = unassigned[0];
  const noStudents = studentCount === 0
    ? '目前還沒有學生加入，可以先指定老師自己，或等學生進來再選。'
    : '點「選擇學生」打開名單，可以直接打字搜尋名字。';
  const rest = unassigned.length > 1 ? `還有 ${unassigned.length - 1} 個角色，選完會自動換下一個。` : '';
  return {
    id: 'assign', target: `[data-tour="role-assign"][data-slot="${first.slotId}"] .custom-select-trigger`, placement: 'left',
    progress: { index: 2, total: ROLE_TOUR_TOTAL },
    title: `幫「${first.label}」選演出者`,
    body: noStudents + rest,
  };
}
