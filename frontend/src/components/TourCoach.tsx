import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TourStep } from '../utils/roleTour.ts';
import { placeBubble, visibleTarget, type Box, type TargetView } from '../utils/tourGeometry.ts';
import './TourCoach.css';

interface TourCoachProps {
  step: TourStep;
  onClose: () => void;
}

/** 被框起來的目標加上這個 class：框線畫在目標本身，捲動時跟著原生移動、被容器自然裁切 */
const TARGET_CLASS = 'tour-target';
/** 完成畫面停留幾秒後自動關掉 */
const DONE_AUTO_CLOSE_MS = 6000;

/** 會裁切目標的祖先（捲動容器）與視窗的邊界 */
function clipsOf(el: HTMLElement) {
  const clips = [{ top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    clips.push({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
  }
  return clips;
}

/**
 * 教學模組的提示：框出畫面上真的按鈕並在旁邊說明，不擋住任何操作。
 * 框線用 class 畫在目標本身，捲動時與目標同步移動、超出捲動容器的部分自然被裁掉；
 * 提示框是 fixed，每幀與捲動事件當下量位置直接寫入；目標被捲出去時改為提示捲動方向。
 */
export default function TourCoach({ step, onClose }: TourCoachProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<TargetView>({ kind: 'none' });
  const [placed, setPlaced] = useState(false);

  const scrollToTarget = () => {
    if (step.target) document.querySelector(step.target)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  // 換到新目標時捲到看得見（例如抽屜裡下方的角色）
  useEffect(() => {
    if (!step.target) return;
    const t = window.setTimeout(() => {
      document.querySelector(step.target!)?.scrollIntoView?.({ block: 'nearest' });
    }, 300);
    return () => window.clearTimeout(t);
  }, [step.target]);

  useLayoutEffect(() => {
    let raf = 0;
    let lastView = '';
    let marked: HTMLElement | null = null;
    const mark = (el: HTMLElement | null) => {
      if (el === marked) return;
      marked?.classList.remove(TARGET_CLASS);
      el?.classList.add(TARGET_CLASS);
      marked = el;
    };
    // 位置直接寫進 DOM，不經過 React 重繪，捲動事件當下就跟上
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      mark(el);
      const r = el?.getBoundingClientRect();
      const rect: Box | null = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const next = el ? visibleTarget(rect, clipsOf(el)) : { kind: 'none' as const };
      const bubble = bubbleRef.current;
      const anchorTop = document.querySelector('.cnav')?.getBoundingClientRect().bottom ?? 64;
      const near = next.kind === 'visible' ? next.box : next.kind === 'hidden' ? next.anchor : null;
      const nextPos = bubble
        ? placeBubble(near, { width: bubble.offsetWidth, height: bubble.offsetHeight }, step.placement, { width: window.innerWidth, height: window.innerHeight }, anchorTop)
        : null;
      if (bubble && nextPos) {
        bubble.style.top = `${nextPos.top}px`;
        bubble.style.left = `${nextPos.left}px`;
        bubble.style.visibility = '';
        setPlaced(true);
      }
      // 只有看得到／看不到、方向改變時才需要重繪內容
      const key = next.kind === 'hidden' ? `hidden:${next.direction}` : next.kind;
      if (key !== lastView) {
        lastView = key;
        setView(next);
      }
    };
    const loop = () => { measure(); raf = requestAnimationFrame(loop); };
    loop();
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', measure, { capture: true });
      mark(null);
    };
  }, [step.target, step.placement]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (step.id !== 'done') return;
    const t = window.setTimeout(onClose, DONE_AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [step.id, onClose]);

  return (
    <>
      <div
        ref={bubbleRef}
        className={`tour-bubble${step.id === 'done' ? ' is-done' : ''}`}
        role="dialog"
        aria-live="polite"
        aria-label={`教學：${step.title}`}
        style={placed ? undefined : { visibility: 'hidden' }}
      >
        <div className="tour-head">
          {step.progress
            ? <span className="tour-progress">{step.progress.index} / {step.progress.total}</span>
            : <span className="material-symbols-outlined tour-done-icon" aria-hidden="true">check_circle</span>}
          <strong className="tour-title">{step.title}</strong>
          <button type="button" className="tour-close" onClick={onClose} aria-label="結束教學" title="結束教學（Esc）">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <p className="tour-body">{step.body}</p>
        {view.kind === 'hidden' && (
          <button type="button" className="tour-scroll" onClick={scrollToTarget}>
            <span className="material-symbols-outlined" aria-hidden="true">{view.direction === 'above' ? 'arrow_upward' : 'arrow_downward'}</span>
            按鈕在{view.direction === 'above' ? '上方' : '下方'}
          </button>
        )}
        {step.id === 'done' && <button type="button" className="tour-finish" onClick={onClose}>知道了</button>}
      </div>
    </>
  );
}
