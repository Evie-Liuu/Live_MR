import type { TaskTemplate } from './types.ts';

export const clothingStoreShopping: TaskTemplate = {
  id: 'clothingStore_shopping',
  version: 1,
  name: '服飾店購物',
  description: '從招呼、詢價、確認購買到結帳的完整購物對話',
  tags: ['購物', '詢價', '結帳'],
  task: {
    title: '服飾店購物',
    sceneId: 'clothingStore_cashier',
    level: 'A1',
    steps: [
      {
        id: 'greet',
        title: '招呼',
        purpose: '問候引導',
        lines: [
          { id: 'greet_1', speakerSlotId: 'cashier', en: 'Hello! Welcome to our clothing store. How can I help you today?', zh: '你好！歡迎來到我們的服飾店，請問有什麼可以幫你？' },
          { id: 'greet_2', speakerSlotId: 'customer', en: "I'm looking for a T-shirt.", zh: '我在找 T 恤。' },
          { id: 'greet_3', speakerSlotId: 'cashier', en: 'Sure. What color are you looking for?', zh: '好的，你想找什麼顏色的呢？' },
          { id: 'greet_4', speakerSlotId: 'customer', en: 'Blue, please.', zh: '藍色，謝謝。' },
        ],
        grammarPoints: ['Hello! / Hi! Welcome to …', 'How can I help you today?', "I'm looking for + 物品"],
        grammarNote: '用於開場，建立友善互動氛圍；顧客用 I\'m looking for 說明需求。',
        teachingNotes: ['引導學生使用完整句子回應。', '可鼓勵學生加入表情與肢體語言。', '注意學生的發音與語調。'],
      },
      {
        id: 'price',
        title: '報價',
        purpose: '價格查詢',
        lines: [
          { id: 'price_1', speakerSlotId: 'customer', en: 'How much is this blue T-shirt?', zh: '這件藍色 T 恤多少錢？' },
          { id: 'price_2', speakerSlotId: 'cashier', en: "It's 20 dollars.", zh: '20 元。' },
          { id: 'price_3', speakerSlotId: 'customer', en: 'Is it on sale?', zh: '有在打折嗎？' },
          { id: 'price_4', speakerSlotId: 'cashier', en: "Yes. It's 10% off today.", zh: '有，今天打九折。' },
        ],
        grammarPoints: ['How much is + 單數物品?', "It's + 數字 + dollars.", 'Is it on sale?'],
        grammarNote: '單數物品用 How much is，複數物品（pants、shoes）用 How much are。',
        teachingNotes: ['可換成不同物品與顏色讓學生替換練習。', '提醒學生數字與 dollars 的發音。'],
      },
      {
        id: 'confirm',
        title: '確認購買',
        purpose: '確認購買',
        lines: [
          { id: 'confirm_1', speakerSlotId: 'customer', en: "I'll take it.", zh: '我要買這件。' },
          { id: 'confirm_2', speakerSlotId: 'cashier', en: 'Great choice! Anything else?', zh: '好選擇！還需要其他東西嗎？' },
          { id: 'confirm_3', speakerSlotId: 'customer', en: "No, that's all. Thank you.", zh: '不用，這樣就好，謝謝。' },
        ],
        grammarPoints: ["I'll take it.", 'Anything else?', "That's all."],
        grammarNote: "I'll take it. 是購物時表示「決定買」的固定說法。",
        teachingNotes: ['可讓學生練習改說 Yes, I also need … 延伸對話。'],
      },
      {
        id: 'pay',
        title: '結帳',
        purpose: '支付結帳',
        lines: [
          { id: 'pay_1', speakerSlotId: 'cashier', en: "That's 18 dollars. Cash or card?", zh: '總共 18 元，付現還是刷卡？' },
          { id: 'pay_2', speakerSlotId: 'customer', en: 'Card, please.', zh: '刷卡，謝謝。' },
          { id: 'pay_3', speakerSlotId: 'cashier', en: 'Here is your receipt.', zh: '這是你的收據。' },
        ],
        grammarPoints: ["That's + 金額.", 'Cash or card?', 'Here is your …'],
        grammarNote: '選擇疑問句 A or B? 回答時直接說出選項即可。',
        teachingNotes: ['可準備道具收據或卡片增加情境感。'],
      },
      {
        id: 'bye',
        title: '結尾',
        purpose: '結束對話',
        lines: [
          { id: 'bye_1', speakerSlotId: 'customer', en: 'Thank you. Bye!', zh: '謝謝，再見！' },
          { id: 'bye_2', speakerSlotId: 'cashier', en: 'You are welcome. Have a nice day!', zh: '不客氣，祝你有美好的一天！' },
        ],
        grammarPoints: ['Have a nice day!'],
        grammarNote: '常見的道別祝福語，也可說 See you!',
        teachingNotes: ['提醒學生道別時保持微笑與眼神接觸。'],
      },
    ],
  },
};
