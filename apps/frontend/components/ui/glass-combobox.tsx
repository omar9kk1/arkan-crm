'use client';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './glass-select.module.css';
interface Option {
  value: string;
  label: string;
}
const normalize = (value: string) =>
  value
    .toLocaleLowerCase('ar')
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/\s+/g, '');
export function GlassCombobox({
  value,
  onChange,
  options,
  label,
  placeholder = 'ابحث بالاسم أو الهاتف...',
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  label: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    menu = useRef<HTMLDivElement>(null),
    root = useRef<HTMLSpanElement>(null),
    id = useId();
  const filtered = options.filter((o) =>
    normalize(o.label).includes(normalize(query)),
  );
  const selected = options.find((o) => o.value === value);
  const start = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
  };
  const choose = (option: Option) => {
    onChange(option.value);
    setOpen(false);
  };
  useEffect(() => {
    if (!open || !input.current || !menu.current) return;
    const popup = menu.current;
    const position = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const bottom =
        (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0);
      const below = bottom - rect.bottom - 12,
        above = rect.top - 12;
      const up = below < 160 && above > below;
      popup.style.width = `${Math.min(rect.width, window.innerWidth - 24)}px`;
      popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12))}px`;
      popup.style.maxHeight = `${Math.max(60, Math.min(240, up ? above : below))}px`;
      popup.style.top = up ? 'auto' : `${rect.bottom + 6}px`;
      popup.style.bottom = up
        ? `${window.innerHeight - rect.top + 6}px`
        : 'auto';
    };
    position();
    popup.showPopover();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const scroll = (e: Event) => {
      if (!popup.contains(e.target as Node)) position();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    return () => {
      popup.hidePopover();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);
  return (
    <span className={styles.root} ref={root}>
      <input
        ref={input}
        className={styles.trigger}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={
          open && filtered[active] ? `${id}-${active}` : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : selected?.label || ''}
        onClick={() => {
          if (!open) start();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'Tab') setOpen(false);
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (open) {
              const option = filtered[active];
              if (option) choose(option);
            } else start();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              start();
              return;
            }
            setActive((i) =>
              Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  i + (e.key === 'ArrowDown' ? 1 : -1),
                ),
              ),
            );
          }
        }}
      />
      <div
        ref={menu}
        id={id}
        popover="manual"
        role="listbox"
        aria-label={label}
        className={styles.menu}
        onMouseDown={(e) => e.preventDefault()}
      >
        {filtered.map((option, index) => (
          <div
            key={option.value}
            id={`${id}-${index}`}
            role="option"
            aria-selected={option.value === value}
            data-active={index === active}
            className={styles.option}
            onPointerMove={() => setActive(index)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              choose(option);
            }}
          >
            {option.label}
          </div>
        ))}
        {!filtered.length && (
          <div className={styles.option} role="status">
            لا توجد نتائج مطابقة
          </div>
        )}
      </div>
    </span>
  );
}
