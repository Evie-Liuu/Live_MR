import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dropdownPlacement, filterOptions, type SelectOption } from '../utils/selectDropdown.ts';

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 沒有選中任何選項時顯示 */
  placeholder?: string;
  /** 選單上方加搜尋框，可打字篩選 */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
}

/** 選單實際能顯示的範圍：最近一層會裁切內容的祖先與視窗的交集 */
function visibleBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'visible') continue;
    const rect = p.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

export default function CustomSelect({
  value, options, onChange, disabled, placeholder, searchable, searchPlaceholder = '搜尋…', emptyText = '找不到符合的項目',
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** 選單畫到這個方向之後要捲到看得見；null＝不用捲 */
  const scrollWhenRef = useRef<'down' | 'up' | null>(null);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 打開時量一次，繪製前就決定方向。之後打字篩選不重算，否則選單會跳來跳去
  useLayoutEffect(() => {
    if (!isOpen) return;
    const dropdown = dropdownRef.current;
    const trigger = triggerRef.current;
    if (!dropdown || !trigger) return;
    const place = dropdownPlacement(trigger.getBoundingClientRect(), visibleBounds(trigger), dropdown.offsetHeight);
    scrollWhenRef.current = place.scroll ? place.direction : null;
    setDirection(place.direction);
    // 不讓瀏覽器為了對焦而捲動，位置由方向與下面的捲動決定
    searchRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  // 要等新方向畫到 DOM 才能捲：剛打開的這一輪，選單可能還在上次開啟的方向
  useLayoutEffect(() => {
    if (!isOpen || scrollWhenRef.current !== direction) return;
    scrollWhenRef.current = null;
    dropdownRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [isOpen, direction]);

  const selectedOption = options.find(o => o.value === value);
  const visibleOptions = filterOptions(options, query);

  const choose = (next: string) => {
    onChange(next);
    close();
  };

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 注音選字時的 Enter、方向鍵是給輸入法的
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const count = visibleOptions.length;
      if (count) setActiveIndex(i => (i + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = visibleOptions[activeIndex];
      if (active) choose(active.value);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div className={`custom-select-container ${disabled ? 'disabled' : ''}`} ref={selectRef}>
      <div
        ref={triggerRef}
        className={`custom-select-trigger slot-select-ui ${disabled ? 'disabled' : ''}`}
        onClick={() => {
          if (disabled) return;
          if (isOpen) close();
          else setIsOpen(true);
        }}
      >
        <div className="custom-select-value">
          {!disabled && selectedOption
            ? selectedOption.label
            : <span style={{ color: '#999' }}>{selectedOption?.label ?? placeholder}</span>}
        </div>
        <span className="material-symbols-outlined custom-select-icon">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </div>
      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className={`custom-select-dropdown ${direction === 'up' ? 'custom-select-dropdown--up' : ''} ${searchable ? 'custom-select-dropdown--search' : ''}`}
        >
          {searchable && (
            <input
              ref={searchRef}
              type="text"
              className="custom-select-search"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
              onKeyDown={handleSearchKey}
            />
          )}
          <div className="custom-select-options">
            {visibleOptions.map((opt, i) => (
              <div
                key={opt.value}
                className={`custom-select-option ${opt.value === value ? 'selected' : ''} ${searchable && i === activeIndex ? 'active' : ''}`}
                onClick={() => choose(opt.value)}
              >
                {opt.label}
                {opt.value === value && <span className="material-symbols-outlined check-icon">check</span>}
              </div>
            ))}
            {visibleOptions.length === 0 && <div className="custom-select-empty">{emptyText}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
