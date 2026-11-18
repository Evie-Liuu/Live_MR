import type { TaskTemplate } from './types.ts';

// 角色對應：Shop Assistant A → cashier、Shop Assistant B → staff、Customer A → customer、Customer B → customer2
export const clothingStoreExchange: TaskTemplate = {
  id: 'clothingStore_exchange',
  version: 1,
  name: '服飾店退換貨',
  description: '顧客買的藍色 T 恤太大，回店裡換小一號；另一位顧客拿錯顏色也來換貨。2–4 人演出，每段附台下互動點',
  tags: ['換貨', '尺寸', '收據', '服務'],
  icon: 'swap_horiz',
  color: 'purple',
  task: {
    title: '服飾店退換貨',
    sceneId: 'clothingStore_cashier',
    level: 'A1-A2',
    // 3 人：店員 ×1、顧客 ×2（店員 B 的台詞由店員 A 說）
    // 2 人：店員 ×1、顧客 ×1，刪掉顧客 B 的換貨支線（含店員對他說的話），只留顧客 A 的換貨流程
    castOptions: [
      { merge: { staff: 'cashier' } },
      { merge: { staff: 'cashier' }, omit: ['customer2'] },
    ],
    steps: [
      {
        id: 'step1',
        title: '打招呼與說明問題',
        purpose: '能表達退換貨需求，並說明遇到的問題',
        lines: [
          { id: 'step1_1', speakerSlotId: 'customer', en: "Hello. I'd like to exchange this T-shirt.", zh: '你好，我想換這件 T 恤。', gesture: 'hold', prop: 'tshirt_blue' },
          { id: 'step1_2', speakerSlotId: 'cashier', en: "Hello! Sure. What's the problem?", zh: '你好！當然可以。請問有什麼問題呢？', gesture: 'nod' },
          { id: 'step1_3', speakerSlotId: 'customer', en: "It's too big for me.", zh: '這件對我來說太大了。', gesture: 'point', pointAt: 'tshirt_blue' },
          { id: 'step1_4', speakerSlotId: 'cashier', en: 'I see. Would you like a smaller size?', zh: '我明白了。你想換小一號嗎？', gesture: 'hold', prop: 'tshirt_blue' },
        ],
        grammarPoints: ["I'd like to exchange this T-shirt.", "What's the problem?", "It's too big for me.", 'Would you like a smaller size?'],
        grammarNote: [
          "I'd like to + 動詞：禮貌地表達需求，例如 I'd like to exchange this T-shirt.（我想換這件 T 恤。）",
          "What's the problem?：詢問對方遇到什麼問題。",
          'too + 形容詞：表示「太……」，例如 too big（太大）、too small（太小）。',
          'Would you like + 名詞?：詢問對方是否想要某樣東西，例如 Would you like a smaller size?（你想換小一號嗎？）',
        ].join('\n'),
        teachingNotes: [
          '區分 return（退貨）與 exchange（換貨）：本課主要練習換貨，不涉及退款。',
          '引導學生理解 too big 是尺寸過大的原因，而不是單純描述商品大小。',
          "I'd like to... 比 I want to... 更適合商店服務情境中的禮貌表達。",
          '可 2–4 人演出（角色配置切換演出人數）：3 人時店員 B 的台詞由店員 A 說；2 人時再刪掉顧客 B 的換貨支線，只演顧客 A 的換貨流程。',
        ],
        checkpoints: [
          {
            id: 'step1_cp1', title: '聽力理解', question: 'Why does {customer} want to exchange the T-shirt?',
            options: ["It's too small.", "It's too big.", "It's the wrong color."], answerIndex: 1,
          },
        ],
      },
      {
        id: 'step2',
        title: '檢查商品與尋找解決方法',
        purpose: '能詢問商品尺寸、提供收據，並確認是否有合適的替換商品',
        lines: [
          { id: 'step2_1', speakerSlotId: 'customer', en: 'Yes, please. Do you have a small one?', zh: '是的，麻煩你。有小號的嗎？', gesture: 'nod' },
          { id: 'step2_2', speakerSlotId: 'staff', en: 'Let me check. Do you have the receipt?', zh: '我確認一下。你有收據嗎？', gesture: 'hold', prop: 'tshirt_blue' },
          { id: 'step2_3', speakerSlotId: 'customer', en: 'Yes, here it is.', zh: '有，在這裡。', gesture: 'handOver', prop: 'receipt' },
          { id: 'step2_4', speakerSlotId: 'staff', en: 'Thank you. Let me check the size.', zh: '謝謝。我確認一下尺寸。' },
          { id: 'step2_5', speakerSlotId: 'cashier', en: 'The T-shirt looks fine.', zh: '這件 T 恤看起來沒有問題。' },
          { id: 'step2_6', speakerSlotId: 'customer2', en: 'Excuse me. Can I exchange my T-shirt, too?', zh: '不好意思，我也可以換我的 T 恤嗎？', gesture: 'hold', prop: 'tshirt_red' },
          { id: 'step2_7', speakerSlotId: 'cashier', en: "Of course. What's the problem with yours?", zh: '當然可以。你的 T 恤有什麼問題呢？', branch: 'customer2' },
          { id: 'step2_8', speakerSlotId: 'customer2', en: 'I got the wrong color.', zh: '我拿錯顏色了。', gesture: 'point', pointAt: 'tshirt_red' },
        ],
        grammarPoints: [
          'Do you have a small one?', 'Let me check.', 'Do you have the receipt?', 'Here it is.',
          'The T-shirt looks fine.', 'Can I exchange my T-shirt, too?', "What's the problem with yours?", 'I got the wrong color.',
        ],
        grammarNote: [
          'Do you have + 商品?：詢問店家是否有某樣商品，例如 Do you have a small one?',
          'one：代替前面提過的可數名詞，避免重複使用 T-shirt。',
          'Let me + 動詞：表示「讓我……」，常用於服務情境，例如 Let me check.',
          'receipt：收據，用來確認購買資訊。',
          'Here it is.：遞交對方所需物品時使用，例如收據。',
          'look + 形容詞：描述看起來的狀態，例如 looks fine（看起來沒有問題）。',
          'the wrong + 名詞：表示錯誤的物品或選項，例如 the wrong color（錯誤的顏色）。',
          'yours：名詞性所有格，代替 your T-shirt，避免重複。',
        ].join('\n'),
        teachingNotes: [
          '協助學生分辨 small / smaller：small 是小號，smaller 是比較小的，適合表達想換小一號。',
          '透過情境理解 receipt 的用途，不需要花太多時間講解收據的實際格式。',
          '顧客 B 的支線是另一種換貨原因，讓學生練習從尺寸問題延伸到顏色問題（2 人演出時不演）。',
          'one 和 yours 都可以避免重複名詞，但用法不同：a small one 是「一件小號的」；What\'s the problem with yours? 是「你的那件有什麼問題？」',
        ],
        checkpoints: [
          {
            id: 'step2_cp1', title: '聽力理解', question: 'What does {customer} need to show the store assistant?',
            options: ['A receipt', 'A student ID', 'A shopping bag'], answerIndex: 0,
          },
        ],
      },
      {
        id: 'step3',
        title: '完成換貨與道別',
        purpose: '能確認換貨結果、表達感謝，並完成服務情境中的禮貌對話',
        lines: [
          { id: 'step3_1', speakerSlotId: 'staff', en: 'We have a small one. Here you are.', zh: '我們有小號的。給你。', gesture: 'handOver', prop: 'tshirt_blue_small' },
          { id: 'step3_2', speakerSlotId: 'customer', en: 'Great! This size is much better.', zh: '太好了！這個尺寸好多了。', gesture: 'happy' },
          { id: 'step3_3', speakerSlotId: 'staff', en: 'No problem. You can keep the new one.', zh: '不客氣。你可以把這件新的帶走。', gesture: 'nod' },
          { id: 'step3_4', speakerSlotId: 'customer', en: 'Thank you for your help.', zh: '謝謝你的幫忙。', gesture: 'nod' },
          { id: 'step3_5', speakerSlotId: 'cashier', en: 'We can exchange yours for another color, too.', zh: '我們也可以幫你換成另一個顏色。', branch: 'customer2' },
          { id: 'step3_6', speakerSlotId: 'customer2', en: 'Perfect! Thank you.', zh: '太好了！謝謝。', gesture: 'happy' },
          { id: 'step3_7', speakerSlotId: 'cashier', en: "You're welcome. Have a nice day!", zh: '不客氣，祝你有美好的一天！', gesture: 'wave' },
          { id: 'step3_8', speakerSlotId: 'customer', en: 'Goodbye!', zh: '再見！', gesture: 'wave' },
          { id: 'step3_9', speakerSlotId: 'customer2', en: 'Goodbye!', zh: '再見！', gesture: 'wave' },
        ],
        grammarPoints: [
          'We have a small one. Here you are.', 'This size is much better.', 'You can keep the new one.', 'Thank you for your help.',
          'We can exchange yours for another color, too.', 'Perfect! Thank you.', "You're welcome. Have a nice day!", 'Goodbye!',
        ],
        grammarNote: [
          'Here you are.：遞交物品時使用，意思是「給你」。',
          'much + 比較級：加強比較程度，例如 much better（好很多）。',
          'keep：保留、留下，例如 You can keep the new one.',
          'Thank you for + 名詞：感謝對方的幫助或付出，例如 Thank you for your help.',
          'exchange A for B：用 A 換成 B，例如 exchange this T-shirt for a smaller one。',
          'another + 單數可數名詞：表示另一個，例如 another color（另一個顏色）。',
          "You're welcome.：回應對方的感謝。",
          'Have a nice day!：服務結束時常用的禮貌用語。',
        ].join('\n'),
        teachingNotes: [
          '引導學生理解換貨完成的結果：顧客 A 拿到合適的尺寸，顧客 B 則更換成另一個顏色（2 人演出時只有顧客 A）。',
          '可以透過角色動作輔助理解，例如遞出新商品、接過商品、微笑與道別。',
          'much better 是本段值得練習的比較級表達；可延伸比較 bigger / smaller / better。',
        ],
        checkpoints: [
          {
            id: 'step3_cp1', title: '聽力理解', question: 'What does {customer} get at the end?',
            options: ['A smaller T-shirt.', 'A refund.', 'A different receipt.'], answerIndex: 0,
          },
        ],
      },
    ],
  },
};
