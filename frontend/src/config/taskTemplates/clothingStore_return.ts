import type { TaskTemplate } from './types.ts';

export const clothingStoreReturn: TaskTemplate = {
  id: 'clothingStore_return',
  version: 1,
  name: '退換貨',
  description: '說明退貨原因、出示收據，選擇退款或換貨',
  tags: ['退貨', '換貨', '退款'],
  task: {
    title: '退換貨',
    sceneId: 'clothingStore_cashier',
    level: 'A1-A2',
    steps: [
      {
        id: 'reason',
        title: '說明原因',
        purpose: '說明問題',
        lines: [
          { id: 'reason_1', speakerSlotId: 'customer', en: 'Hi. I bought this shirt yesterday, but it has a hole.', zh: '你好，我昨天買了這件襯衫，但它有一個破洞。', gesture: 'point' },
          { id: 'reason_2', speakerSlotId: 'cashier', en: "I'm sorry about that. Do you have the receipt?", zh: '很抱歉，你有收據嗎？', gesture: 'bow' },
          { id: 'reason_3', speakerSlotId: 'customer', en: 'Yes, here it is.', zh: '有，在這裡。', gesture: 'handOver' },
        ],
        grammarPoints: ['I bought … yesterday.', "I'm sorry about that.", 'Do you have the receipt?'],
        grammarNote: '描述昨天發生的事用過去式：buy → bought。',
        teachingNotes: ['可請學生替換不同問題：too small、wrong color、broken zipper。'],
      },
      {
        id: 'options',
        title: '退款或換貨',
        purpose: '做出選擇',
        lines: [
          { id: 'options_1', speakerSlotId: 'cashier', en: 'Would you like a refund or an exchange?', zh: '你想要退款還是換貨？' },
          { id: 'options_2', speakerSlotId: 'customer', en: "I'd like to exchange it for a new one, please.", zh: '我想換一件新的，謝謝。' },
          { id: 'options_3', speakerSlotId: 'cashier', en: 'No problem. Let me get you a new one.', zh: '沒問題，我去幫你拿一件新的。', gesture: 'nod' },
        ],
        grammarPoints: ['Would you like A or B?', "I'd like to + 動詞", 'exchange it for …'],
        grammarNote: "Would you like … / I'd like … 是比 Do you want / I want 更禮貌的說法。",
        teachingNotes: ['提醒學生禮貌用語的語氣。', '可讓一半學生選 refund、一半選 exchange 比較對話差異。'],
      },
      {
        id: 'finish',
        title: '結尾',
        purpose: '結束對話',
        lines: [
          { id: 'finish_1', speakerSlotId: 'cashier', en: "Here you are. Sorry for the trouble.", zh: '給你，造成不便很抱歉。', gesture: 'handOver' },
          { id: 'finish_2', speakerSlotId: 'customer', en: "That's OK. Thanks for your help!", zh: '沒關係，謝謝你的幫忙！', gesture: 'happy' },
        ],
        grammarPoints: ['Sorry for the trouble.', 'Thanks for your help!'],
        grammarNote: 'for 後面接名詞，說明道歉或感謝的原因。',
        teachingNotes: ['引導學生在收到協助後主動道謝。'],
      },
    ],
  },
};
