import type { DialogueTask } from '../../types/dialogueTask.ts';

/** 任務庫卡片圖示底色 */
export type TemplateColor = 'orange' | 'purple' | 'teal';

/**
 * 內建任務模板：外層是任務庫的上架資訊，task 與任務編輯器的 DialogueTask 格式完全相同。
 * 新增模板的流程見 ./README.md。
 */
export interface TaskTemplate {
  /** 穩定 id，上線後永遠不改（老師的任務會記錄 sourceTemplate.id） */
  id: string;
  /** 內容大幅修改時 +1 */
  version: number;
  /** 卡片標題 */
  name: string;
  /** 一句話說明 */
  description: string;
  /** 篩選 / 搜尋用標籤 */
  tags: string[];
  /** 任務庫卡片圖示（Material Symbols 名稱），未設定用 assignment */
  icon?: string;
  /** 任務庫卡片圖示底色，未設定依順序輪替 */
  color?: TemplateColor;
  task: DialogueTask;
}
