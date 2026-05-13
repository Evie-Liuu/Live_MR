// frontend/src/config/taskHints.ts
// ─────────────────────────────────────────────────────────────────────────────
// Task Hints — 5-level scaffolding prompts for teaching tasks.
//   key = TaskItem.id (見 scenes.ts)。查無 key → BigScreen 顯示「此任務尚無提示」。
//   本檔目前覆蓋服飾店收銀台「Ask for a Price」模組（ask_price_1~10）。
//
// 五階層說明：
//   ① Key Sentence Structure — 句型骨架，例如 "How much + is + the + [item]?"
//   ② Partial Sentence       — 含空格的半句，填空練習
//   ③ Unscramble the Words   — 打亂的單字 chips，學生自行重組
//   ④ Complete Sentence      — 完整目標句，讓學生直接看到答案
//   ⑤ Extra Phrases          — 延伸例句，展示相同情境的其他說法
// ─────────────────────────────────────────────────────────────────────────────

export type HintLevel =
  | 'keyStructure'
  | 'partialSentence'
  | 'unscramble'
  | 'completeSentence'
  | 'extraPhrases'

export interface TaskHint {
  /** ① 關鍵句型骨架，以 [ ] 標示可替換部分 */
  keyStructure: string
  /** ② 部分句子：含 ___ 空格的填空句 */
  partialSentence: string
  /** ③ 重組單字：打亂順序的字詞 chips */
  unscramble: string[]
  /** ④ 完整句子示範 */
  completeSentence: string
  /** ⑤ 延伸例句：2~3 個同義／類似說法 */
  extraPhrases: string[]
}

/** 有序的階層元資料 —— HostSession 按鈕列與 BigScreen 標籤都用這個 */
export const HINT_LEVELS: ReadonlyArray<{ level: HintLevel; num: string; label: string }> = [
  { level: 'keyStructure', num: '①', label: '核心句型' },
  { level: 'partialSentence', num: '②', label: '半句提示' },
  { level: 'unscramble', num: '③', label: '單字重組' },
  { level: 'completeSentence', num: '④', label: '完整句型' },
  { level: 'extraPhrases', num: '⑤', label: '延伸用語' },
]

export function hintLevelMeta(level: HintLevel) {
  return HINT_LEVELS.find(l => l.level === level)!
}

export const TASK_HINTS: Record<string, TaskHint> = {
  // ── Ask for a Price ──────────────────────────────────────────────────────

  ask_price_1: {
    keyStructure: 'What + is + the price of + the + [color] + [item]?',
    partialSentence: 'What is the _____ of the _____ _____?',
    unscramble: ['What', 'the', 'T-shirt?', 'price', 'of', 'is', 'the', 'blue'],
    completeSentence: 'What is the price of the blue T-shirt?',
    extraPhrases: [
      'How much is the blue T-shirt?',
      'How much does the blue T-shirt cost?',
    ],
  },

  // ask_price_2: {
  //   keyStructure: 'How much + is + the + [color] + [item]?',
  //   partialSentence: 'How much ___ the black jacket?',
  //   unscramble: ['How', 'much', 'is', 'the', 'black', 'jacket?'],
  //   completeSentence: 'How much is the black jacket?',
  //   extraPhrases: [
  //     'How much does the black jacket cost?',
  //     'What is the price of the black jacket?',
  //   ],
  // },

  // ask_price_3: {
  //   keyStructure: 'How much + is + the + [color] + [item]?',
  //   partialSentence: 'How much ___ the red skirt?',
  //   unscramble: ['How', 'much', 'is', 'the', 'red', 'skirt?'],
  //   completeSentence: 'How much is the red skirt?',
  //   extraPhrases: [
  //     'How much does the red skirt cost?',
  //     'What is the price of the red skirt?',
  //   ],
  // },

  // ask_price_4: {
  //   keyStructure: 'How much + is + the + [color] + [item]?',
  //   partialSentence: 'How much ___ the white shirt?',
  //   unscramble: ['How', 'much', 'is', 'the', 'white', 'shirt?'],
  //   completeSentence: 'How much is the white shirt?',
  //   extraPhrases: [
  //     'How much does the white shirt cost?',
  //     'Could you tell me how much the white shirt is?',
  //   ],
  // },

  // ask_price_5: {
  //   keyStructure: 'How much + are + the + [item]?',
  //   partialSentence: 'How much ___ the pants?',
  //   unscramble: ['How', 'much', 'are', 'the', 'pants?'],
  //   completeSentence: 'How much are the pants?',
  //   extraPhrases: [
  //     'How much do the pants cost?',
  //     'Could you tell me how much the pants are?',
  //   ],
  // },

  // ask_price_6: {
  //   keyStructure: 'How much + are + [items] + in total?',
  //   partialSentence: 'How much are these two items ___?',
  //   unscramble: ['How', 'much', 'are', 'these', 'two', 'items', 'in', 'total?'],
  //   completeSentence: 'How much are these two items in total?',
  //   extraPhrases: [
  //     'What is the total price for these two items?',
  //     'How much do these two items cost together?',
  //   ],
  // },

  // ask_price_7: {
  //   keyStructure: 'Is + this/that + the + final + price?',
  //   partialSentence: 'Is this ___ final price?',
  //   unscramble: ['Is', 'this', 'the', 'final', 'price?'],
  //   completeSentence: 'Is this the final price?',
  //   extraPhrases: [
  //     'Is that your final price?',
  //     'Is this price final?',
  //   ],
  // },

  // ask_price_8: {
  //   keyStructure: 'Is + the + [adjective] + price + correct/right?',
  //   partialSentence: 'Is the ___ price correct?',
  //   unscramble: ['Is', 'the', 'displayed', 'price', 'correct?'],
  //   completeSentence: 'Is the displayed price correct?',
  //   extraPhrases: [
  //     'Is this price right?',
  //     'Is the price on the tag correct?',
  //   ],
  // },

  // ask_price_9: {
  //   keyStructure: 'How much + is + it + after + the + [discount/sale]?',
  //   partialSentence: 'How much is it ___ the discount?',
  //   unscramble: ['How', 'much', 'is', 'it', 'after', 'the', 'discount?'],
  //   completeSentence: 'How much is it after the discount?',
  //   extraPhrases: [
  //     'How much does it cost after the discount?',
  //     'What is the price after the discount?',
  //   ],
  // },

  // ask_price_10: {
  //   keyStructure: 'Which + one/item + is + cheaper/more expensive?',
  //   partialSentence: 'Which one ___ cheaper?',
  //   unscramble: ['Which', 'one', 'is', 'cheaper?'],
  //   completeSentence: 'Which one is cheaper?',
  //   extraPhrases: [
  //     'Which item is cheaper?',
  //     'Which of these is cheaper?',
  //   ],
  // },

  ask_size_1: {
    keyStructure: 'Do you have + this + [item] + in + [size]?',
    partialSentence: '____ you ____ this _____ _____ medium?',
    unscramble: ['you', 'this', 'T-shirt', 'in', 'Do', 'have', 'medium?'],
    completeSentence: 'Do you have this medium T-shirt?',
    extraPhrases: [
      'Do you have a medium size?',
      'Can I get this T-shirt in medium?'
    ],
  },

  compare_items_2: {
    keyStructure: 'Which + [item] + looks better, the + [color] + one or the + [color] + one?',
    partialSentence: '_____ Jacket looks _____, the _____ one ____ the _____ one?',
    unscramble: ['looks', 'better', 'the', 'one', 'black', 'the', 'brown', 'one?', 'Which', 'jacket', 'or'],
    completeSentence: 'Which jacket looks better, the black one or the brown one?',
    extraPhrases: [
      'Which color looks better?',
      'Which jacket do you like better?',
    ],
  }
}
