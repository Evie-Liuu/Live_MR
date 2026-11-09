/**
 * 劇本模擬器的動作庫（VRMA）。
 *
 * 目前的 .vrma 由 scripts/generate-vrma.mjs 程式產生（npm run generate:vrma）。
 * 取得授權的專業動作檔後，直接用同名檔案覆蓋 public/animations/<id>.vrma 即可，程式不用改；
 * 新增動作則要同時改這裡、backend/src/dialogueTaskTypes.ts 的 GESTURE_IDS 與產生器。
 *
 * 大人與小孩手臂比例不同，同一個動作檔套到另一種體型手的位置會跑掉（例如揮手打到臉）。
 * 大人版放成 <名稱>.adult.vrma（例如 wave.adult.vrma），vrmSources 標記 bodyType: 'adult'
 * 的模型會自動優先使用，沒有大人版就用原檔（見 utils/animationLibrary.ts）。
 */

/** 待機循環動作：不是可排進台詞的手勢，不列入 GESTURES；檔案不存在時用程式待機姿勢 */
export const IDLE_ANIMATION_URL = '/animations/idle.vrma';

export type GestureId = 'wave' | 'nod' | 'bow' | 'point' | 'handOver' | 'thumbsUp' | 'happy';

export interface GestureDef {
  id: GestureId;
  label: string;
  /** 清單 / 選單用的小圖示 */
  icon: string;
  url: string;
}

export const GESTURES: readonly GestureDef[] = [
  { id: 'wave', label: '揮手', icon: '👋', url: '/animations/wave.vrma' },
  { id: 'nod', label: '點頭', icon: '🙆', url: '/animations/nod.vrma' },
  { id: 'bow', label: '鞠躬', icon: '🙇', url: '/animations/bow.vrma' },
  { id: 'point', label: '指向', icon: '👉', url: '/animations/point.vrma' },
  { id: 'handOver', label: '遞東西', icon: '🤲', url: '/animations/handOver.vrma' },
  { id: 'thumbsUp', label: '比讚', icon: '👍', url: '/animations/thumbsUp.vrma' },
  { id: 'happy', label: '開心', icon: '😄', url: '/animations/happy.vrma' },
];

export const GESTURE_IDS: readonly GestureId[] = GESTURES.map(g => g.id);

export function isGestureId(v: unknown): v is GestureId {
  return typeof v === 'string' && (GESTURE_IDS as readonly string[]).includes(v);
}

export function gestureById(id: string | undefined): GestureDef | undefined {
  return id ? GESTURES.find(g => g.id === id) : undefined;
}
