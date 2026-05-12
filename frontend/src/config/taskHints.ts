// frontend/src/config/taskHints.ts
// ─────────────────────────────────────────────────────────────────────────────
// Task Hints — 5-level scaffolding prompts for teaching tasks.
//   key = TaskItem.id (見 scenes.ts)。查無 key → BigScreen 顯示「此任務尚無提示」。
//   本檔目前只覆蓋服飾店收銀台「Ask for a Price」模組（ask_price_1~10）。
// ─────────────────────────────────────────────────────────────────────────────

export type HintLevel = 'keyword' | 'sentenceStart' | 'halfPattern' | 'options' | 'fullDemo'

export interface TaskHint {
  /** ① 關鍵字 chips */
  keyword: string[]
  /** ② 句首提示，例如 "How much ...?" */
  sentenceStart: string
  /** ③ 半句型，用 ___ 表示要填的空格 */
  halfPattern: string
  /** ④ 選項引導：2~3 個完整句子讓學生選 */
  options: string[]
  /** ⑤ 完整示範 */
  fullDemo: string
}

/** 有序的階層元資料 —— HostSession 按鈕列與 BigScreen 標籤都用這個 */
export const HINT_LEVELS: ReadonlyArray<{ level: HintLevel; num: string; label: string }> = [
  { level: 'keyword', num: '①', label: '關鍵字' },
  { level: 'sentenceStart', num: '②', label: '句首提示' },
  { level: 'halfPattern', num: '③', label: '半句型提示' },
  { level: 'options', num: '④', label: '選項引導' },
  { level: 'fullDemo', num: '⑤', label: '完整示範' },
  // { level: 'fullDemo', num: '②', label: '完整示範' },
]

export function hintLevelMeta(level: HintLevel) {
  return HINT_LEVELS.find(l => l.level === level)!
}

export const TASK_HINTS: Record<string, TaskHint> = {
  ask_price_1: {
    keyword: ['price', 'blue', 'T-shirt'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the blue T-shirt?',
    options: [
      'How much is the blue T-shirt?',
      'How much does the blue T-shirt cost?',
      'What is the price of the blue T-shirt?',
    ],
    fullDemo: 'How much is the blue T-shirt?',
  },
  ask_price_2: {
    keyword: ['price', 'black', 'jacket'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the black jacket?',
    options: [
      'How much is the black jacket?',
      'How much does the black jacket cost?',
      'What is the price of the black jacket?',
    ],
    fullDemo: 'How much is the black jacket?',
  },
  ask_price_3: {
    keyword: ['price', 'red', 'skirt'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the red skirt?',
    options: [
      'How much is the red skirt?',
      'How much does the red skirt cost?',
      'What is the price of the red skirt?',
    ],
    fullDemo: 'How much is the red skirt?',
  },
  ask_price_4: {
    keyword: ['how much', 'white', 'shirt'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the white shirt?',
    options: [
      'How much is the white shirt?',
      'How much does the white shirt cost?',
      'Could you tell me how much the white shirt is?',
    ],
    fullDemo: 'How much is the white shirt?',
  },
  ask_price_5: {
    keyword: ['how much', 'pants'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ the pants?',
    options: [
      'How much are the pants?',
      'How much do the pants cost?',
      'Could you tell me how much the pants are?',
    ],
    fullDemo: 'How much are the pants?',
  },
  ask_price_6: {
    keyword: ['total', 'price', 'two items'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ these two items together?',
    options: [
      'How much are these two items in total?',
      'What is the total price for these two items?',
      'How much do these two items cost together?',
    ],
    fullDemo: 'How much are these two items in total?',
  },
  ask_price_7: {
    keyword: ['final', 'price'],
    sentenceStart: 'Is this ...?',
    halfPattern: 'Is this ___ the final price?',
    options: [
      'Is this the final price?',
      'Is that your final price?',
      'Is this price final?',
    ],
    fullDemo: 'Is this the final price?',
  },
  ask_price_8: {
    keyword: ['price', 'correct', 'right'],
    sentenceStart: 'Is the price ...?',
    halfPattern: 'Is the ___ price correct?',
    options: [
      'Is the displayed price correct?',
      'Is this price right?',
      'Is the price on the tag correct?',
    ],
    fullDemo: 'Is the displayed price correct?',
  },
  ask_price_9: {
    keyword: ['how much', 'after', 'discount'],
    sentenceStart: 'How much ...?',
    halfPattern: 'How much ___ it after the discount?',
    options: [
      'How much is it after the discount?',
      'How much does it cost after the discount?',
      'What is the price after the discount?',
    ],
    fullDemo: 'How much is it after the discount?',
  },
  ask_price_10: {
    keyword: ['which', 'cheaper'],
    sentenceStart: 'Which one ...?',
    halfPattern: 'Which one ___ cheaper?',
    options: [
      'Which one is cheaper?',
      'Which item is cheaper?',
      'Which of these is cheaper?',
    ],
    fullDemo: 'Which one is cheaper?',
  },
}
