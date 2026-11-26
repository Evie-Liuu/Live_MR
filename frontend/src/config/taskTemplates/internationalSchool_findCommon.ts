import type { TaskTemplate } from './types.ts';

// 角色對應：Alex → student、Jamie → student2、Mia → exchange、Leo → exchange2
export const internationalSchoolFindCommon: TaskTemplate = {
  id: 'internationalSchool_findCommon',
  version: 1,
  name: '聊聊興趣、尋找共同點',
  description: '同學們互相詢問放學後的興趣、喜歡的音樂，找出大家都喜歡打籃球，並邀請彼此一起活動。2–4 人演出，每段附台下互動點',
  tags: ['興趣', '喜好', '共同點', '邀請'],
  icon: 'sports_basketball',
  color: 'orange',
  task: {
    title: '聊聊興趣、尋找共同點',
    sceneId: 'internationalSchool_classroom',
    level: 'A1-A2',
    // 3 人（Alex、Mia、Jamie）：Leo 的台詞由 Jamie 說；接起來會變成自問自答的支線刪掉
    // 2 人（Alex、Mia）：Jamie、Leo 的台詞都由 Alex 說；問 Jamie 的話與重複附和的支線刪掉
    castOptions: [
      { merge: { student2: 'student', exchange2: 'student' } },
      { merge: { exchange2: 'student2' } },
    ],
    steps: [
      {
        id: 'step1',
        title: '聊聊興趣',
        purpose: '能詢問同學放學後的興趣、用 I like + V-ing 分享喜好，並用 How about you? 反問',
        lines: [
          { id: 'step1_1', speakerSlotId: 'student', en: 'What do you like to do after school, Mia?', zh: 'Mia，你放學後喜歡做什麼？' },
          { id: 'step1_2', speakerSlotId: 'exchange', en: 'I like playing basketball. How about you?', zh: '我喜歡打籃球。你呢？' },
          { id: 'step1_3', speakerSlotId: 'student', en: 'Me too! I love basketball!', zh: '我也是！我超喜歡籃球！', gesture: 'nod' },
          { id: 'step1_4', speakerSlotId: 'student2', en: 'Really? I like basketball, too!', zh: '真的嗎？我也喜歡打籃球！', gesture: 'nod', branch: 'student2' },
          { id: 'step1_5', speakerSlotId: 'exchange2', en: 'Cool! What else do you like to do?', zh: '真不錯！你還喜歡做什麼？' },
          { id: 'step1_6', speakerSlotId: 'exchange', en: 'I like listening to music, too.', zh: '我也喜歡聽音樂。', gesture: 'nod' },
          { id: 'step1_7', speakerSlotId: 'student', en: 'What kind of music do you like?', zh: '你喜歡哪一種類型的音樂？' },
          { id: 'step1_8', speakerSlotId: 'exchange', en: 'I like pop music.', zh: '我喜歡流行音樂。' },
          { id: 'step1_9', speakerSlotId: 'exchange', en: 'How about you, Jamie?', zh: 'Jamie，你呢？', branch: 'student2' },
        ],
        grammarPoints: [
          'What do you like to do…?', 'I like + V-ing.', 'How about you?', 'Me too!', 'What kind of music do you like?',
        ],
        grammarNote: [
          'What do you like to do after school? 詢問放學後喜歡做的活動。',
          'I like playing basketball. 使用 like + V-ing 表達喜好。',
          'How about you? 是簡短自然的反問方式，可以讓對話繼續。',
          'Me too! 可用來回應對方剛提到、自己也有的相同喜好。',
          'What kind of…? 用來詢問種類，例如 What kind of music…?',
        ].join('\n'),
        teachingNotes: [
          '本段先建立「詢問興趣、回答、反問」的對話模式。',
          'Me too! 與句尾的 too 都是自然的英文用法，不需要刻意避免；但連續重複時，可改用 Nice!、That sounds fun! 等不同回應。',
          '可 2–4 人演出（角色配置切換演出人數）：3 人版沒有 Leo，他的台詞由 Jamie 說；2 人版只有 Alex 與 Mia，Jamie、Leo 的台詞由 Alex 說。',
        ],
        checkpoints: [
          {
            id: 'step1_cp1', title: '理解興趣', question: 'What does Mia like to do after school?',
            options: ['Play basketball', 'Play the piano', 'Go swimming'], answerIndex: 0,
          },
        ],
      },
      {
        id: 'step2',
        title: '音樂與共同喜好',
        purpose: '能分享喜歡的音樂，並詢問對方活動的習慣、地點與對象',
        lines: [
          { id: 'step2_1', speakerSlotId: 'student2', en: 'I like K-pop!', zh: '我喜歡 K-pop！', gesture: 'happy' },
          { id: 'step2_2', speakerSlotId: 'exchange2', en: 'Nice! I like pop music, too.', zh: '不錯！我也喜歡流行音樂。', gesture: 'nod', branch: 'exchange2' },
          { id: 'step2_3', speakerSlotId: 'exchange', en: 'Do you play basketball with your friends?', zh: '你會和朋友一起打籃球嗎？' },
          { id: 'step2_4', speakerSlotId: 'exchange2', en: 'Yes! We play after school.', zh: '會啊！我們放學後會一起打。', gesture: 'nod' },
          { id: 'step2_5', speakerSlotId: 'exchange2', en: 'Where do you play basketball?', zh: '你們在哪裡打籃球？', branch: 'student2' },
          { id: 'step2_6', speakerSlotId: 'student', en: 'At the school gym.', zh: '在學校體育館。', gesture: 'point' },
          { id: 'step2_7', speakerSlotId: 'student2', en: 'Who do you usually play with, Mia?', zh: 'Mia，你通常和誰一起打球？' },
          { id: 'step2_8', speakerSlotId: 'exchange', en: 'I play with my classmates.', zh: '我和同學一起打球。' },
          { id: 'step2_9', speakerSlotId: 'student2', en: 'That sounds fun!', zh: '聽起來很有趣！', gesture: 'nod' },
          { id: 'step2_10', speakerSlotId: 'exchange2', en: 'Maybe we can all play together!', zh: '或許我們可以一起打球！' },
        ],
        grammarPoints: [
          'I like…', 'Do you…?', 'Where do you…?', 'Who do you… with?', 'That sounds fun!', 'Maybe we can…',
        ],
        grammarNote: [
          'I like K-pop. 用具體的音樂類型分享喜好。',
          'Do you play basketball with your friends? 使用 Do you…? 詢問對方是否有某種習慣。',
          'Where do you play basketball? 詢問活動地點。',
          'Who do you usually play with? 詢問通常和誰一起活動。',
          'That sounds fun! 表達對對方所分享內容的正面反應。',
          'Maybe we can… 可以用來提出一個可能的共同活動。',
        ].join('\n'),
        teachingNotes: [
          'Jamie 喜歡 K-pop，Leo 喜歡流行音樂，讓角色的興趣有一些差異，避免每個人都只回答相同內容。',
          '本段讓學生練習不同的回應方式，不需要每句都使用 Me too!。',
          'K-pop 可直接作為音樂類型的詞彙，不必額外延伸文化背景。',
          '2 人版沒有 Jamie，「I like K-pop!」由 Alex 說；台下互動點問的是 Jamie，可改問 Alex。',
        ],
        checkpoints: [
          {
            id: 'step2_cp1', title: '音樂喜好', question: 'What kind of music does Jamie like?',
            options: ['Classical music', 'K-pop', 'Jazz'], answerIndex: 1,
          },
        ],
      },
      {
        id: 'step3',
        title: '找到共同點',
        purpose: '能描述彼此相同的喜好，並提出可以一起做的事',
        lines: [
          { id: 'step3_1', speakerSlotId: 'student', en: 'I like basketball, and Mia likes it, too.', zh: '我喜歡打籃球，Mia 也喜歡。' },
          { id: 'step3_2', speakerSlotId: 'exchange', en: 'Yes! We can play together after school.', zh: '對！我們可以放學後一起打球。', gesture: 'nod' },
          { id: 'step3_3', speakerSlotId: 'student2', en: 'We all have something in common!', zh: '我們大家都有共同點！' },
          { id: 'step3_4', speakerSlotId: 'exchange2', en: 'Yes! We can play basketball and share our favorite music.', zh: '沒錯！我們可以一起打籃球，也可以分享自己最喜歡的音樂。', gesture: 'happy', branch: 'exchange2' },
        ],
        grammarPoints: [
          'I like…, and … likes it, too.', 'We can…', 'We have something in common.', 'Share our favorite…',
        ],
        grammarNote: [
          'I like basketball, and Mia likes it, too. 用來表達兩個人有相同的喜好。',
          'We can… 後面接原形動詞，例如 We can play together.',
          'We have something in common. 表示兩人或多人之間有共同點。',
          'Share our favorite music 表示分享彼此喜歡的音樂。',
        ].join('\n'),
        teachingNotes: [
          '本段負責整理前面談到的興趣，讓學生理解對話中的共同點。',
          'it 在 Mia likes it, too 中指前面提到的 basketball。',
          '本段為簡短結尾；如果希望增加練習時間，可讓學生補充自己喜歡的運動或音樂，但不需要為了增加句數而重複相同句型。',
          '2、3 人版以「We all have something in common!」作結，Leo 的最後一句不演。',
        ],
        checkpoints: [
          {
            id: 'step3_cp1', title: '找出共同點', question: 'What activity can the students do together?',
            options: ['Play basketball', 'Go shopping', 'Watch a movie'], answerIndex: 0,
          },
        ],
      },
    ],
  },
};
