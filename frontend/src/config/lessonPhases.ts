/**
 * 上課三階段：任務前（暖身，VTS 視覺思維提問）→ 任務中（情境對話）→ 任務後（討論）。
 * 任務前 / 任務後目前依學生程度使用內建題組；任務後另外帶出對話各步驟的語言重點。
 */
import type { CefrLevel } from '../types/lessonPlan.ts';
import type { DialogueTask } from '../types/dialogueTask.ts';

export type LessonPhase = 'pre' | 'during' | 'post';

export const LESSON_PHASES: { id: LessonPhase; label: string; sub: string }[] = [
  { id: 'pre', label: '任務前', sub: '暖身觀察' },
  { id: 'during', label: '任務中', sub: '情境對話' },
  { id: 'post', label: '任務後', sub: '討論回顧' },
];

export function phaseMeta(phase: LessonPhase) {
  return LESSON_PHASES.find(p => p.id === phase) ?? LESSON_PHASES[1];
}

export interface PhaseQuestion {
  en: string;
  zh: string;
}

export interface PhaseContent {
  questions: PhaseQuestion[];
  /** 句型框架，協助學生開口 */
  frames: string[];
  /** 語言重點（任務後：對話各步驟的句型） */
  focusPoints: string[];
}

interface PhaseBank {
  questions: PhaseQuestion[];
  frames: string[];
}

/** 任務前：VTS 觀察提問，依程度由指認、描述逐步到推論與理由 */
const PRE_BANK: Record<CefrLevel, PhaseBank> = {
  'preA1-A1': {
    questions: [
      { en: 'Look! What can you see?', zh: '看！你看到什麼？' },
      // { en: 'Point to something red.', zh: '指出紅色的東西。' },
      // { en: 'Is it big or small?', zh: '它是大的還是小的？' },
    ],
    frames: ['I see a ___.', "It's ___."],
  },
  A1: {
    questions: [
      { en: 'What do you see in this place?', zh: '你在這個地方看到什麼？' },
      // { en: 'Where are we?', zh: '我們在哪裡？' },
      // { en: 'Who is here? What are they doing?', zh: '誰在這裡？他們在做什麼？' },
    ],
    frames: ['I see ___.', 'There is / There are ___.', 'He / She is ___ing.'],
  },
  'A1-A2': {
    questions: [
      { en: "What's going on in this picture?", zh: '這個畫面裡發生了什麼事？' },
      // { en: 'What do you see that makes you say that?', zh: '你看到什麼讓你這樣說？' },
      // { en: 'What more can we find?', zh: '我們還能發現什麼？' },
    ],
    frames: ['I think ___ because I see ___.', 'Maybe ___.'],
  },
  'A2-B1': {
    questions: [
      { en: "What's going on in this picture?", zh: '這個畫面裡發生了什麼事？' },
      // { en: 'What do you see that makes you say that?', zh: '你看到什麼讓你這樣說？' },
      // { en: 'What more can we find?', zh: '我們還能發現什麼？' },
      // { en: 'How do you think the people feel? Why?', zh: '你覺得這些人有什麼感受？為什麼？' },
    ],
    frames: ['It looks like ___.', 'I think ___ because ___.', 'I agree with ___, and I also noticed ___.'],
  },
};

/** 任務後：討論與反思，依程度由喜好、回想到比較與假設 */
const POST_BANK: Record<CefrLevel, PhaseBank> = {
  'preA1-A1': {
    questions: [
      // { en: 'Did you like the role-play?', zh: '你喜歡剛剛的角色扮演嗎？' },
      { en: 'Which word did you learn today?', zh: '今天學到哪個單字？' },
    ],
    frames: ['I like ___.', 'Yes. / No.'],
  },
  A1: {
    questions: [
      { en: 'What happened in the conversation?', zh: '對話中發生了什麼事？' },
      // { en: 'Which sentence was easy? Which was difficult?', zh: '哪一句簡單？哪一句比較難？' },
      // { en: 'Do you go to a place like this?', zh: '你會去這樣的地方嗎？' },
    ],
    frames: ['I said ___.', '___ is easy / difficult.'],
  },
  'A1-A2': {
    questions: [
      { en: 'What did each person want? How did they ask for it?', zh: '每個人想要什麼？他們怎麼表達？' },
      // { en: 'Is it the same in Taiwan?', zh: '在台灣也是這樣嗎？' },
      // { en: 'What could you say differently next time?', zh: '下次你可以怎麼換個說法？' },
    ],
    frames: ['In Taiwan, ___.', 'Next time I will say ___.'],
  },
  'A2-B1': {
    questions: [
      // { en: 'Was the conversation polite? Which words made it polite?', zh: '這段對話有禮貌嗎？哪些用語讓它有禮貌？' },
      // { en: 'What would you do if something went wrong?', zh: '如果過程出了狀況，你會怎麼做？' },
      { en: 'Compare this with your own experience.', zh: '和你自己的經驗比較看看。' },
    ],
    frames: ['I think it was ___ because ___.', 'If ___, I would ___.'],
  },
};

const MAX_FOCUS_POINTS = 6;

/** 取得任務前 / 任務後的內容；任務中沒有題組（使用對話步驟） */
export function phaseContent(task: DialogueTask, phase: LessonPhase): PhaseContent {
  if (phase === 'during') return { questions: [], frames: [], focusPoints: [] };
  const bank = (phase === 'pre' ? PRE_BANK : POST_BANK)[task.level] ?? (phase === 'pre' ? PRE_BANK : POST_BANK).A1;
  const focusPoints = phase === 'post'
    ? [...new Set(task.steps.flatMap(s => s.grammarPoints).map(g => g.trim()).filter(Boolean))].slice(0, MAX_FOCUS_POINTS)
    : [];
  return { questions: bank.questions, frames: bank.frames, focusPoints };
}
