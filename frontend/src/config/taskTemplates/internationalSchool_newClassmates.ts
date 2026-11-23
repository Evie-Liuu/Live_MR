import type { TaskTemplate } from './types.ts';

// 角色對應：Alex → student、Jamie → student2、Mia → exchange、Leo → exchange2
export const internationalSchoolNewClassmates: TaskTemplate = {
  id: 'internationalSchool_newClassmates',
  version: 1,
  name: '認識新同學',
  description: '台灣學生和來自洛杉磯、多倫多的交換生打招呼、自我介紹、聊家鄉與台灣，最後請大家吃鳳梨酥。2–4 人演出，每段附台下互動點',
  tags: ['打招呼', '自我介紹', '國家城市', '台灣文化'],
  icon: 'school',
  color: 'teal',
  task: {
    title: '認識新同學',
    sceneId: 'internationalSchool_classroom',
    level: 'A1-A2',
    // 3 人（Alex、Mia、Jamie）：Leo 的台詞由 Mia 說，Leo 自我介紹與聊多倫多的支線刪掉
    // 2 人（Alex、Mia）：再把 Jamie 的台詞改由 Alex 說，Jamie 自我介紹與「Me, too!」的支線刪掉
    castOptions: [
      { merge: { student2: 'student', exchange2: 'exchange' } },
      { merge: { exchange2: 'exchange' } },
    ],
    steps: [
      {
        id: 'step1',
        title: '初次見面',
        purpose: '能打招呼、介紹自己、詢問姓名與對方來自哪裡',
        lines: [
          { id: 'step1_1', speakerSlotId: 'student', en: "Hi! I'm Alex. What's your name?", zh: '嗨！我是 Alex。你叫什麼名字？', gesture: 'wave' },
          { id: 'step1_2', speakerSlotId: 'exchange', en: "Hi, I'm Mia. Nice to meet you!", zh: '嗨，我是 Mia。很高興認識你！', gesture: 'nod' },
          { id: 'step1_3', speakerSlotId: 'student2', en: "Hi! I'm Jamie. Are you new here?", zh: '嗨！我是 Jamie。你是新來的嗎？', gesture: 'wave', branch: 'student2' },
          { id: 'step1_4', speakerSlotId: 'exchange', en: "Yes, I am! I'm from the US.", zh: '對，我是！我來自美國。', gesture: 'nod', branch: 'student2' },
          { id: 'step1_5', speakerSlotId: 'student', en: 'Where are you from, Mia?', zh: 'Mia，你來自哪裡？' },
          { id: 'step1_6', speakerSlotId: 'exchange', en: "I'm from Los Angeles.", zh: '我來自洛杉磯。' },
          { id: 'step1_7', speakerSlotId: 'exchange2', en: "Hi! I'm Leo. I'm new here, too.", zh: '嗨！我是 Leo。我也是新來的。', gesture: 'wave', branch: 'exchange2' },
          { id: 'step1_8', speakerSlotId: 'student2', en: 'Nice to meet you, Leo! Where are you from?', zh: '很高興認識你，Leo！你來自哪裡？', branch: 'exchange2' },
          { id: 'step1_9', speakerSlotId: 'exchange2', en: "I'm from Toronto, Canada.", zh: '我來自加拿大多倫多。', gesture: 'nod', branch: 'exchange2' },
          { id: 'step1_10', speakerSlotId: 'student', en: 'Wow! Is Toronto a big city?', zh: '哇！多倫多是個大城市嗎？', branch: 'exchange2' },
          { id: 'step1_11', speakerSlotId: 'exchange2', en: "Yes, it is! It's a very big city.", zh: '對！那是一座很大的城市。', gesture: 'nod', branch: 'exchange2' },
        ],
        grammarPoints: [
          "I'm…", "What's your name?", 'Nice to meet you!', 'Are you new here?',
          'Where are you from?', "I'm from…", 'Is … a big city?',
        ],
        grammarNote: [
          "I'm 是 I am 的縮寫，用於介紹姓名、身分或所在地等資訊。",
          "Where are you from? 的回答可使用 I'm from + 地名。",
          "Are you new here? 是一般疑問句，可用 Yes, I am. 或 No, I'm not. 回答。",
          'Nice to meet you! 通常用於第一次見面時。',
        ].join('\n'),
        teachingNotes: [
          '可先由老師示範自我介紹，再讓學生輪流扮演新同學。',
          '本段重點是打招呼、姓名和國籍／城市，不要求學生進行複雜的地理介紹。',
          '角色可透過揮手、轉身、點頭等簡單動作呈現，避免需要複雜的 3D 動作。',
          '可 2–4 人演出（角色配置切換演出人數）：3 人版沒有 Leo，2 人版只有 Alex 與 Mia，少掉的角色自我介紹會一起刪掉。',
        ],
        checkpoints: [
          {
            id: 'step1_cp1', title: '認識新同學', question: 'Where is Mia from?',
            options: ['Toronto, Canada', 'Los Angeles, the US', 'Taipei, Taiwan'], answerIndex: 1,
          },
        ],
      },
      {
        id: 'step2',
        title: '認識彼此',
        purpose: '能詢問城市特色與喜好，並邀請對方一起參觀學校',
        lines: [
          { id: 'step2_1', speakerSlotId: 'student2', en: 'Is Los Angeles a sunny city, Mia?', zh: 'Mia，洛杉磯是個陽光充足的城市嗎？' },
          { id: 'step2_2', speakerSlotId: 'exchange', en: "Yes! It's usually sunny, and it has many beaches.", zh: '是的！那裡通常陽光充足，而且有很多海灘。', gesture: 'happy' },
          { id: 'step2_3', speakerSlotId: 'student', en: 'Do you like Taiwan, Mia?', zh: 'Mia，你喜歡台灣嗎？' },
          { id: 'step2_4', speakerSlotId: 'exchange', en: "Yes, I do! I love the food, but it's a little hot.", zh: '喜歡！我很喜歡這裡的食物，不過天氣有一點熱。' },
          { id: 'step2_5', speakerSlotId: 'exchange2', en: 'What do you like about Taiwan?', zh: '你喜歡台灣的哪些地方？', branch: 'exchange2' },
          { id: 'step2_6', speakerSlotId: 'exchange', en: 'I like the food! And the people are very nice.', zh: '我喜歡這裡的食物！而且這裡的人都很親切。', gesture: 'nod' },
          { id: 'step2_7', speakerSlotId: 'student2', en: "That's great! I can show you around our school.", zh: '那太好了！我可以帶你參觀我們的學校。', gesture: 'point' },
          { id: 'step2_8', speakerSlotId: 'student', en: "Me, too! Let's explore the school together.", zh: '我也可以！我們一起逛逛學校吧。', branch: 'student2' },
          { id: 'step2_9', speakerSlotId: 'exchange', en: 'Really? That would be great!', zh: '真的嗎？那太好了！', gesture: 'nod' },
        ],
        grammarPoints: [
          'Is … a … city?', 'Do you like…?', 'Yes, I do.', 'What do you like about…?',
          'I love…', 'I like…', 'I can show you around…', "Let's… together.",
        ],
        grammarNote: [
          'Is Los Angeles a sunny city? 使用 Is…? 詢問城市的特徵。',
          'Do you like Taiwan? 使用 Do you…? 詢問對方的喜好。',
          'What do you like about Taiwan? 可以用來詢問對方喜歡某個地方的哪些方面。',
          'show you around 表示帶某人參觀或四處看看。',
          "Let's + 原形動詞 可用來提出邀請，例如 Let's explore the school together.",
        ].join('\n'),
        teachingNotes: [
          '以陽光、海灘、食物和人情等具體內容呈現文化交流，讓學生練習描述家鄉與分享感受。',
          'sunny、beaches、food 可搭配場景背景或簡單圖片輔助理解。',
          '可提醒學生，回答喜好時不只有 Yes, I do.，也能補充原因或個人感受。',
          '台詞「but it\'s a little hot」可請演出的學生自行加上搧風的動作。',
        ],
        checkpoints: [
          {
            id: 'step2_cp1', title: '城市特色與個人喜好', question: 'What does Mia say about Los Angeles?',
            options: ['It is usually sunny and has many beaches.', 'It is always snowy.', 'It has no beaches.'], answerIndex: 0,
          },
        ],
      },
      {
        id: 'step3',
        title: '分享台灣特色',
        purpose: '能詢問最喜歡的事物、表達想嘗試，並禮貌地邀請、道謝與回應',
        lines: [
          { id: 'step3_1', speakerSlotId: 'exchange', en: "What's your favorite Taiwanese food, Alex?", zh: 'Alex，你最喜歡的台灣食物是什麼？' },
          { id: 'step3_2', speakerSlotId: 'student', en: "I love beef noodles! They're really good.", zh: '我很喜歡牛肉麵！真的很好吃。', gesture: 'happy' },
          { id: 'step3_3', speakerSlotId: 'exchange2', en: "I've never tried them. I want to try them!", zh: '我從來沒吃過牛肉麵。我想試試看！' },
          { id: 'step3_4', speakerSlotId: 'student2', en: 'I can show you some good places to eat.', zh: '我可以帶你們去一些好吃的店。' },
          { id: 'step3_5', speakerSlotId: 'exchange', en: 'Great! I love trying new food.', zh: '太好了！我很喜歡嘗試新的食物。', gesture: 'nod' },
          { id: 'step3_6', speakerSlotId: 'student', en: 'By the way, I brought some Taiwanese snacks today!', zh: '對了，我今天帶了一些台灣點心！', gesture: 'hold', prop: 'pineapple_cake' },
          { id: 'step3_7', speakerSlotId: 'exchange2', en: 'Really? What are they?', zh: '真的嗎？這些是什麼？' },
          { id: 'step3_8', speakerSlotId: 'student', en: "They're pineapple cakes. They're popular in Taiwan.", zh: '這些是鳳梨酥。它們在台灣很受歡迎。', gesture: 'hold', prop: 'pineapple_cake' },
          { id: 'step3_9', speakerSlotId: 'student2', en: 'Would you like to try one?', zh: '你想試吃一個嗎？', gesture: 'handOver', prop: 'pineapple_cake' },
          { id: 'step3_10', speakerSlotId: 'exchange2', en: 'Sure! Thank you!', zh: '好啊！謝謝你！', gesture: 'hold', prop: 'pineapple_cake' },
          { id: 'step3_11', speakerSlotId: 'student', en: "You're welcome! I hope you like it.", zh: '不客氣！希望你會喜歡。', gesture: 'nod' },
          { id: 'step3_12', speakerSlotId: 'exchange', en: "Come on! Let's explore the school together!", zh: '走吧！我們一起逛逛學校吧！', gesture: 'point' },
        ],
        grammarPoints: [
          "What's your favorite…?", "I've never tried…", 'I want to try…', 'What are they?',
          'Would you like to…?', 'Sure!', 'Thank you!', "You're welcome!",
        ],
        grammarNote: [
          "What's your favorite Taiwanese food? 可以用來詢問最喜歡的食物，也可以替換成 song, sport, subject 等詞彙。",
          "I've 是 I have 的縮寫。I've never tried them 是現在完成式，表示「我從來沒有嘗試過它們」。對 A1–A2 學生，可先將整句作為實用表達練習，再簡單提醒 I've = I have，不必深入講解文法。",
          "them 在 I've never tried them 中指前面提到的牛肉麵。",
          'Would you like to try one? 是較有禮貌的邀請方式。',
          "You're welcome! 是回應 Thank you! 的常用說法。",
        ].join('\n'),
        teachingNotes: [
          "I've never tried… 對初階學生稍有難度，建議先模仿整句，再逐步理解縮寫與句型。",
          '鳳梨酥由 Alex 拿出來，Jamie 遞給 Leo；人數較少時改由接手的角色遞出與接過。',
        ],
        checkpoints: [
          {
            id: 'step3_cp1', title: '台灣特色點心', question: 'What snack does Alex bring to school?',
            options: ['Pineapple cakes', 'Chocolate cookies', 'Sandwiches'], answerIndex: 0,
          },
        ],
      },
    ],
  },
};
