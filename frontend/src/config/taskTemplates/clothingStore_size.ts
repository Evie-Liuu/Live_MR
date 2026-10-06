import type { TaskTemplate } from './types.ts';

export const clothingStoreSize: TaskTemplate = {
  id: 'clothingStore_size',
  version: 1,
  name: '詢問尺寸與試穿',
  description: '詢問尺寸、要求試穿，並依合身程度換尺寸',
  tags: ['尺寸', '試穿'],
  icon: 'forum',
  color: 'purple',
  task: {
    title: '詢問尺寸與試穿',
    sceneId: 'clothingStore_cashier',
    level: 'A1',
    steps: [
      {
        id: 'ask_size',
        title: '詢問尺寸',
        purpose: '尺寸詢問',
        lines: [
          { id: 'ask_size_1', speakerSlotId: 'customer', en: 'Excuse me. Do you have this jacket in medium?', zh: '不好意思，這件外套有 M 號嗎？', gesture: 'point' },
          { id: 'ask_size_2', speakerSlotId: 'cashier', en: 'Yes, we do. Here you are.', zh: '有的，給你。', gesture: 'handOver' },
        ],
        grammarPoints: ['Do you have this + 物品 + in + 尺寸?', 'Here you are.'],
        grammarNote: '尺寸前用介系詞 in：in small / in medium / in large。',
        teachingNotes: ['可先複習 small、medium、large 三個單字。'],
      },
      {
        id: 'try_on',
        title: '試穿',
        purpose: '提出請求',
        lines: [
          { id: 'try_on_1', speakerSlotId: 'customer', en: 'Can I try it on?', zh: '我可以試穿嗎？' },
          { id: 'try_on_2', speakerSlotId: 'cashier', en: 'Sure. The fitting room is over there.', zh: '當然，試衣間在那邊。', gesture: 'point' },
        ],
        grammarPoints: ['Can I + 動詞?', 'try it on'],
        grammarNote: 'try on 是可分片語動詞，代名詞要放中間：try it on，不說 try on it。',
        teachingNotes: ['示範手勢指出方向（over there）。'],
      },
      {
        id: 'change_size',
        title: '換尺寸',
        purpose: '表達需求',
        lines: [
          { id: 'change_size_1', speakerSlotId: 'cashier', en: 'How does it fit?', zh: '穿起來合身嗎？', gesture: 'nod' },
          { id: 'change_size_2', speakerSlotId: 'customer', en: "It's too small. Do you have a bigger one?", zh: '太小了，有大一點的嗎？' },
          { id: 'change_size_3', speakerSlotId: 'cashier', en: 'Here is a large one.', zh: '這件是 L 號。', gesture: 'handOver' },
          { id: 'change_size_4', speakerSlotId: 'customer', en: 'This one fits well. Thank you!', zh: '這件很合身，謝謝！', gesture: 'thumbsUp' },
        ],
        grammarPoints: ["It's too + 形容詞.", 'a bigger / smaller one', 'It fits well.'],
        grammarNote: 'too 表示「過於」；比較級 bigger、smaller 用來要求不同尺寸。',
        teachingNotes: ['讓學生輪流說 too big / too small / too long 做替換練習。'],
      },
    ],
  },
};
