import type { TaskTemplate } from './types.ts';

// 角色對應：Shop Assistant A → cashier、Shop Assistant B → staff、Customer A → customer、Customer B → customer2
export const clothingStoreShoppingTogether: TaskTemplate = {
  id: 'clothingStore_shoppingTogether',
  version: 1,
  name: '服飾店結伴購物',
  description: '兩位店員接待兩位顧客，從需求、詢價折扣到共同結帳；2–4 人演出，每段附台下互動點',
  tags: ['購物', '詢價', '折扣', '結帳'],
  icon: 'groups',
  color: 'teal',
  task: {
    title: '服飾店結伴購物',
    sceneId: 'clothingStore_cashier',
    level: 'A1-A2',
    // 3 人：店員 ×1、顧客 ×2（10、6、4 句）；2 人：店員 ×1、顧客 ×1（10、10 句）
    castOptions: [
      { merge: { staff: 'cashier' } },
      { merge: { staff: 'cashier', customer2: 'customer' } },
    ],
    steps: [
      {
        id: 'step1',
        title: '招呼與購物需求',
        purpose: '理解問候、表達需求、詢問顏色',
        lines: [
          { id: 'step1_1', speakerSlotId: 'cashier', en: 'Hello! Welcome to our clothing store. How can I help you today?', zh: '你好！歡迎來到我們的服飾店，請問有什麼可以幫你？', gesture: 'wave' },
          { id: 'step1_2', speakerSlotId: 'customer', en: "I'm looking for a T-shirt.", zh: '我在找 T 恤。' },
          { id: 'step1_3', speakerSlotId: 'cashier', en: 'Sure. What color are you looking for?', zh: '好的，你想找什麼顏色的呢？', gesture: 'point' },
          { id: 'step1_4', speakerSlotId: 'customer', en: 'Blue, please.', zh: '藍色，謝謝。' },
          { id: 'step1_5', speakerSlotId: 'customer2', en: "I'm looking for a T-shirt, too. Red, please.", zh: '我也在找 T 恤。請給我紅色的。' },
          { id: 'step1_6', speakerSlotId: 'staff', en: 'Sure! Here is a red T-shirt.', zh: '好的！這裡有一件紅色 T 恤。' },
        ],
        grammarPoints: ['How can I help you today?', "I'm looking for + 商品", 'What color are you looking for?', '顏色 + please.', 'too'],
        grammarNote: [
          'How can I help you today?：店員詢問顧客需要什麼協助的常用句型。',
          "I'm looking for + 商品：表達正在尋找的物品，例如 I'm looking for a T-shirt.",
          'What color are you looking for?：詢問對方想找什麼顏色。',
          'Blue, please.：以「顏色＋please」簡短回答購物需求，適合初級學習者。',
          'too：表示「也」，用來補充自己有相同需求。',
        ].join('\n'),
        teachingNotes: [
          '讓學生辨認店員與顧客的角色，理解購物對話的基本順序：打招呼 → 說明需求 → 回答顏色。',
          '引導學生聽懂不同顧客選擇的顏色，避免只依賴畫面判斷。',
          '初級學生可先練習完整句型，再逐步接受簡短回答，例如 Blue, please.',
          '可 2–4 人演出（角色配置切換演出人數）：3 人時店員 B 的台詞由店員 A 說；2 人時再把顧客 B 的台詞併給顧客 A。',
        ],
        checkpoints: [
          { id: 'step1_cp1', title: '聽力理解', question: 'Which color does Customer A want?', options: ['Red', 'Blue', 'Yellow'], answerIndex: 1 },
        ],
      },
      {
        id: 'step2',
        title: '詢價與折扣',
        purpose: '詢問價格、理解折扣資訊',
        lines: [
          { id: 'step2_1', speakerSlotId: 'customer', en: 'How much is this blue T-shirt?', zh: '這件藍色 T 恤多少錢？', gesture: 'point' },
          { id: 'step2_2', speakerSlotId: 'staff', en: "It's 20 dollars.", zh: '20 元。' },
          { id: 'step2_3', speakerSlotId: 'customer2', en: 'Is it on sale?', zh: '有在打折嗎？' },
          { id: 'step2_4', speakerSlotId: 'staff', en: "Yes. It's 10% off today.", zh: '有，今天打九折。', gesture: 'happy' },
          { id: 'step2_5', speakerSlotId: 'customer2', en: 'How much is the red T-shirt?', zh: '紅色 T 恤多少錢？' },
          { id: 'step2_6', speakerSlotId: 'cashier', en: "It's 15 dollars.", zh: '15 元。' },
        ],
        grammarPoints: ['How much is + 單數商品?', "It's + 價格.", 'Is it on sale?', "It's 10% off.", 'this + 顏色 + 商品'],
        grammarNote: [
          'How much is + 單數商品?：詢問單一商品的價格。',
          "It's + 價格.：回答商品價格，例如 It's 20 dollars.",
          'Is it on sale?：詢問商品是否正在特價。',
          "It's 10% off.：表示打九折，也就是原價的 90%。",
          'this + 顏色 + 商品：用來指稱特定商品，例如 this blue T-shirt.',
        ].join('\n'),
        teachingNotes: [
          '引導學生區分商品的原價與折扣後價格：藍色 T 恤原價 20 元，打九折後為 18 元。',
          '透過聆聽辨認不同商品的價格，並將商品顏色與價格連結。',
          '可先讓學生熟悉 How much is...? 的句型，再替換商品或價格進行練習。',
        ],
        checkpoints: [
          {
            id: 'step2_cp1', title: '價格理解', question: 'How much is the red T-shirt?',
            options: ['10 dollars', '15 dollars', '20 dollars'], answerIndex: 1,
            followUp: 'Which T-shirt is more expensive?',
          },
        ],
      },
      {
        id: 'step3',
        title: '購買與付款',
        purpose: '確認購買、詢問付款方式、理解結帳流程',
        lines: [
          { id: 'step3_1', speakerSlotId: 'customer', en: "I'll take it.", zh: '我要買這件。', gesture: 'nod' },
          { id: 'step3_2', speakerSlotId: 'cashier', en: 'Great choice! Anything else?', zh: '好選擇！還需要其他東西嗎？', gesture: 'thumbsUp' },
          { id: 'step3_3', speakerSlotId: 'customer2', en: "That's all. Thank you.", zh: '不用了，謝謝。' },
          { id: 'step3_4', speakerSlotId: 'staff', en: "That's 33 dollars. Cash or card?", zh: '總共 33 元。付現還是刷卡？' },
          { id: 'step3_5', speakerSlotId: 'customer', en: 'Card, please.', zh: '刷卡，謝謝。' },
          { id: 'step3_6', speakerSlotId: 'staff', en: 'Here is your receipt.', zh: '這是你的收據。', gesture: 'handOver' },
          { id: 'step3_7', speakerSlotId: 'customer', en: 'Thank you. Bye!', zh: '謝謝，再見！', gesture: 'wave' },
          { id: 'step3_8', speakerSlotId: 'cashier', en: "You're welcome. Have a nice day!", zh: '不客氣，祝你有美好的一天！', gesture: 'bow' },
        ],
        grammarPoints: ["I'll take it.", 'Anything else?', "That's all.", 'Cash or card?', 'Here is your receipt.', "You're welcome.", 'Have a nice day!'],
        grammarNote: [
          "I'll take it.：表示決定購買某件商品。",
          'Anything else?：詢問顧客是否還需要其他商品。',
          "That's all.：表示沒有其他需求，購物已經結束。",
          'Cash or card?：詢問顧客要付現金或刷卡；Card, please. 表示選擇刷卡付款。',
          'Here is your receipt.：店員交付收據時使用的句型。',
          "You're welcome.：回應對方的感謝；Have a nice day! 是結帳結束時常用的禮貌用語。",
        ].join('\n'),
        teachingNotes: [
          '引導學生理解購物流程：決定購買 → 確認是否需要其他商品 → 結帳 → 選擇付款方式 → 取得收據 → 道別。',
          '著重辨識購買意願與付款方式的表達，讓學生理解對話的實際用途，而非只背誦句子。',
          "I'll take it 中的 it 指前面提到的商品，可配合角色指向商品的動作協助理解。",
          '本段總額設定為 33 元：藍色 T 恤折扣後 18 元，加上紅色 T 恤 15 元。',
        ],
        checkpoints: [
          { id: 'step3_cp1', title: '付款理解', question: 'How does Customer A want to pay?', options: ['Cash', 'Card', 'Mobile payment'], answerIndex: 1 },
        ],
      },
    ],
  },
};
