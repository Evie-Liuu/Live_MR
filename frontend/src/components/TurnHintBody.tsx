import { keywords, openingHint, shownHintLevel, shuffledWords, type HintLevel } from '../utils/turnHints.ts';

/**
 * 逐句演練的台詞提示內容（學生發言畫面與大屏共用）：
 * 中文＋關鍵字 → 開頭＋空格 → 重組字卡 → 完整句子。樣式由 classPrefix 決定（sto＝學生 iPad、bs-th＝大屏）。
 */
export default function TurnHintBody({ line, seq, level, classPrefix }: {
  line: { en: string; zh: string };
  /** 重組字卡的種子（同一輪各畫面順序一致） */
  seq: number;
  level: HintLevel;
  classPrefix: string;
}) {
  const c = (name: string) => `${classPrefix}-${name}`;
  const { en, zh } = line;
  const shown = shownHintLevel(line, level);
  const zhLine = zh && <div className={c('line-zh')}>{zh}</div>;

  if (shown === 0) {
    const words = keywords(en);
    return (
      <>
        {zh && <div className={c('hint-zh')}>{zh}</div>}
        {words.length > 0 && (
          <div className={c('chips')}>
            {words.map(w => <span key={w} className={c('chip')}>{w}</span>)}
          </div>
        )}
      </>
    );
  }
  if (shown === 1) {
    const o = openingHint(en);
    return (
      <>
        <div className={c('line-en')}>
          {o.shown.join(' ')}
          {Array.from({ length: o.blanks }, (_, i) => <span key={i} className={c('blank')} aria-hidden="true" />)}
          {o.mark}
        </div>
        {zhLine}
      </>
    );
  }
  if (shown === 2) {
    return (
      <>
        <div className={`${c('chips')} ${c('chips--shuffle')}`}>
          {shuffledWords(en, seq).map((w, i) => <span key={i} className={c('chip')}>{w}</span>)}
        </div>
        {zhLine}
      </>
    );
  }
  return (
    <>
      <div className={c('line-en')}>{en}</div>
      {zhLine}
    </>
  );
}
