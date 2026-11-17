import type { TaskTemplate } from './types.ts';

// 角色對應：Shop Assistant → staff、Customer A → customer、Customer B → customer2
// 試衣間場景目前沿用收銀台的角色與道具（紅色洋裝、牛仔褲、帽子都在衣架上）
export const clothingStoreTryOn: TaskTemplate = {
  id: 'clothingStore_tryOn',
  version: 1,
  name: '試穿衣服與朋友挑選',
  description: '兩位朋友一起試穿牛仔褲與紅色洋裝、互相給意見，最後搭配一頂帽子。2–3 人演出，每段附台下互動點',
  tags: ['試穿', '穿搭', '徵求意見', '比較'],
  icon: 'checkroom',
  color: 'orange',
  task: {
    title: '試穿衣服與朋友挑選',
    sceneId: 'clothingStore_fitting',
    level: 'A1-A2',
    // 2 人：顧客 ×2，店員的台詞由顧客 B 說；店員專屬的第 17 句（標成店員的支線）刪掉
    castOptions: [
      { merge: { staff: 'customer2' } },
    ],
    steps: [
      {
        id: 'step1',
        title: '試穿牛仔褲與描述尺寸',
        purpose: '能詢問是否可以試穿、徵求朋友意見，並描述尺寸問題',
        lines: [
          { id: 'step1_1', speakerSlotId: 'customer', en: 'Can I try these jeans on?', zh: '我可以試穿這條牛仔褲嗎？', prop: 'pants_jeans' },
          { id: 'step1_2', speakerSlotId: 'staff', en: 'Sure! The fitting room is over there.', zh: '當然可以！試衣間在那邊。', gesture: 'point' },
          { id: 'step1_3', speakerSlotId: 'customer', en: 'What do you think?', zh: '你覺得怎麼樣？', prop: 'pants_jeans', wear: true },
          { id: 'step1_4', speakerSlotId: 'customer2', en: 'They look nice on you!', zh: '你穿起來很好看！', gesture: 'nod' },
          { id: 'step1_5', speakerSlotId: 'customer', en: "Thanks! But they're a little too long.", zh: '謝謝！不過褲子有點太長了。' },
        ],
        grammarPoints: [
          'Can I try these jeans on?', 'The fitting room is over there.', 'What do you think?',
          'They look nice on you!', "They're a little too long.",
        ],
        grammarNote: [
          'Can I + 動詞原形...?：詢問自己是否可以做某件事，例如 Can I try these jeans on?',
          'try on：試穿衣服。受詞為代名詞時，通常說 try them on；受詞為名詞時，可說 try these jeans on。',
          'jeans：牛仔褲，英文通常使用複數形式，因此搭配 these、they、are。',
          'look + 形容詞 + on you：描述衣服穿在某人身上的效果，例如 They look nice on you.',
          'too + 形容詞：表示「太……」，例如 too long（太長）、too short（太短）。',
        ].join('\n'),
        teachingNotes: [
          '特別提醒 jeans 通常使用複數形式：these jeans、they are，避免學生說成 this jeans。',
          '透過褲管過長的角色動作，幫助學生理解 too long。',
          '本段著重試穿及描述尺寸，不延伸到退換貨，以免與情境二重複。',
          "A1 學生可以先使用 They're too long.；A2 學生可以延伸描述原因或感受。",
          '可 2–3 人演出（角色配置切換演出人數）：2 人時店員的台詞改由顧客 B 說，店員專屬的帽子建議句（第 3 段）刪掉。',
        ],
        checkpoints: [
          {
            id: 'step1_cp1', title: '聽力理解', question: "What's the problem with the jeans?",
            options: ["They're too short.", "They're too long.", "They're too small."], answerIndex: 1,
          },
        ],
      },
      {
        id: 'step2',
        title: '試穿洋裝與比較穿搭',
        purpose: '能詢問穿著效果、表達喜好，並說明理由',
        lines: [
          { id: 'step2_1', speakerSlotId: 'customer', en: 'Can I try this red dress on, too?', zh: '我也可以試穿這件紅色洋裝嗎？', gesture: 'point', pointAt: 'dress_red' },
          { id: 'step2_2', speakerSlotId: 'staff', en: 'Of course! Here you are.', zh: '當然可以！給你。', gesture: 'handOver', prop: 'dress_red' },
          { id: 'step2_3', speakerSlotId: 'customer', en: 'How does this dress look?', zh: '這件洋裝看起來怎麼樣？', prop: 'dress_red', wear: true },
          { id: 'step2_4', speakerSlotId: 'customer2', en: 'It looks great on you!', zh: '你穿起來很好看！', gesture: 'thumbsUp' },
          { id: 'step2_5', speakerSlotId: 'customer', en: 'Thanks! I really like this dress.', zh: '謝謝！我真的很喜歡這件洋裝。', gesture: 'happy' },
          { id: 'step2_6', speakerSlotId: 'customer2', en: 'I like the red dress better than the jeans.', zh: '比起那條牛仔褲，我更喜歡這件紅色洋裝。' },
          { id: 'step2_7', speakerSlotId: 'customer', en: 'Really? Why do you think so?', zh: '真的嗎？你為什麼這麼覺得？' },
          { id: 'step2_8', speakerSlotId: 'customer2', en: 'The color looks great on you.', zh: '這個顏色很適合你。', gesture: 'point', pointAt: 'dress_red' },
        ],
        grammarPoints: [
          'Can I try this red dress on, too?', 'How does this dress look?', 'It looks great on you!', 'I really like this dress.',
          'I like the red dress better than the jeans.', 'Why do you think so?', 'The color looks great on you.',
        ],
        grammarNote: [
          'this dress / it：dress 是單數可數名詞，因此搭配 this 或 it。',
          'How does this dress look?：詢問衣服的外觀或穿著效果。',
          'look great on someone：表示某件衣服穿在某人身上很好看。',
          'better than：表示「比……更好」，用於比較兩個選項。',
          'Why do you think so?：詢問對方這樣認為的原因。',
          'look great on you：此處表示顏色或服裝很襯對方，不必延伸成複雜的穿搭理論。',
        ].join('\n'),
        teachingNotes: [
          '本段的比較對象是牛仔褲與洋裝所呈現的穿搭效果，並非直接比較兩件商品的價格。',
          'better than 屬於 A2 延伸語言；A1 學生可以先理解 It looks great on you!。',
          '若覺得完整比較句太長，可以將比較句列為 A2 延伸句，核心對話改用 I like the red dress better.。',
          '透過換裝前後的畫面或角色姿勢差異，協助學生理解服裝比較。',
        ],
        checkpoints: [
          {
            id: 'step2_cp1', title: '聽力理解', question: 'Why does {customer2} like the red dress on {customer}?',
            options: ['The color looks great on {customer}.', 'The dress is cheaper.', 'The dress is bigger.'], answerIndex: 0,
          },
        ],
      },
      {
        id: 'step3',
        title: '選擇服裝與搭配帽子',
        purpose: '能表達決定、提出建議、詢問搭配意見並稱讚對方的選擇',
        lines: [
          { id: 'step3_1', speakerSlotId: 'customer', en: "I think I'll choose this dress.", zh: '我想我會選這件洋裝。', prop: 'dress_red', wear: true },
          { id: 'step3_2', speakerSlotId: 'customer2', en: 'How about this hat?', zh: '這頂帽子怎麼樣？', prop: 'hat' },
          { id: 'step3_3', speakerSlotId: 'customer', en: 'Do you think it looks good with the dress?', zh: '你覺得這頂帽子搭配這件洋裝好看嗎？' },
          { id: 'step3_4', speakerSlotId: 'staff', en: 'Try this hat with the dress!', zh: '試試看用這頂帽子搭配洋裝吧！', gesture: 'happy', branch: 'staff' },
          { id: 'step3_5', speakerSlotId: 'customer2', en: 'Yes! It looks great with the dress.', zh: '好看！它跟這件洋裝很搭。', gesture: 'nod' },
          { id: 'step3_6', speakerSlotId: 'customer', en: 'Great! I like this combination.', zh: '太好了！我喜歡這樣的搭配。', gesture: 'happy', prop: 'hat', wear: true },
          { id: 'step3_7', speakerSlotId: 'customer2', en: 'Good choice! You look great!', zh: '選得好！你看起來很棒！', gesture: 'thumbsUp' },
          { id: 'step3_8', speakerSlotId: 'customer', en: "Thanks! Let's look around some more.", zh: '謝謝！我們再逛逛吧！' },
          { id: 'step3_9', speakerSlotId: 'customer2', en: "Sure! Let's go!", zh: '好啊！我們走吧！', gesture: 'nod' },
        ],
        grammarPoints: [
          "I think I'll choose this dress.", 'How about this hat?', 'Do you think it looks good with the dress?',
          'It looks great with the dress.', 'I like this combination.', 'Good choice!', "Let's look around some more.",
        ],
        grammarNote: [
          "I think I'll + 動詞原形：表示自己目前的決定，例如 I think I'll choose this dress.",
          'How about + 名詞?：提出建議，例如 How about this hat?',
          'look good with：表示兩件服飾或配件搭配起來很好看。',
          'combination：組合、搭配，此處指服裝與配件的整體搭配。',
          'Good choice!：稱讚對方做出好的選擇。',
          "Let's + 動詞原形：提出一起做某件事的建議，例如 Let's look around some more.",
        ].join('\n'),
        teachingNotes: [
          '帽子只在本段作為配件延伸，不需要新增完整的帽子試戴流程或獨立購物任務。',
          '角色無法實際戴上帽子，可以讓顧客拿起帽子並搭配對話完成任務。',
          'look good with 是本段最值得保留的搭配句型，能讓學生把服裝描述延伸到日常穿搭。',
          'A1 學生可以練習 How about this hat? 與 Good choice!；A2 學生可進一步練習詢問搭配意見及描述整體穿搭。',
          '本段不需要再加入付款、折扣或價格，讓三個情境各自保有明確的學習目標。',
        ],
        checkpoints: [
          {
            id: 'step3_cp1', title: '聽力理解', question: 'What does {customer} choose to wear with the red dress?',
            options: ['A blue jacket.', 'A hat.', 'A pair of jeans.'], answerIndex: 1,
          },
        ],
      },
    ],
  },
};
