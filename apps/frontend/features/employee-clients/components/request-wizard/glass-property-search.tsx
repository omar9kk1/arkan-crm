'use client';
import { useEffect, useId, useRef, useState } from 'react';
import styles from '../../../../components/ui/glass-select.module.css';
import {
  usePropertySearch,
  PROPERTY_SEARCH_MIN_QUERY,
} from '../../../../lib/api/use-property-search';
import {
  propertySearchOptionLabel,
  type LinkedPropertySnapshot,
} from './client-request-model';

/**
 * Server-search combobox for linking a REAL program property in the wizard.
 *
 * Mirrors GlassCombobox (same Astra styles, popover positioning and keyboard
 * behaviour) but its options come from the backend while the user types —
 * never a fixed list. Each option is identified by the immutable
 * `Property.id`, and only public listing fields are ever displayed, so no
 * owner/broker contact detail can leak through a result row.
 */
export function GlassPropertySearch({
  label,
  placeholder = 'ابحث بالكود أو المنطقة واختر العقار...',
  snapshot,
  onSelect,
}: {
  label: string;
  placeholder?: string;
  /** The selected property (public fields only); shown when closed. */
  snapshot: LinkedPropertySnapshot | null | undefined;
  onSelect: (snapshot: LinkedPropertySnapshot) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    menu = useRef<HTMLDivElement>(null),
    root = useRef<HTMLSpanElement>(null),
    id = useId();

  // The hook only fires from 2 typed characters, bounded and debounced.
  const { results, searching, error } = usePropertySearch(open ? query : '');

  const start = () => {
    setQuery('');
    setActive(0);
    setOpen(true);
  };
  const choose = (withID: string) => {
    const row = results.find((p) => p.id === withID);
    if (!row) return;
    // Only public fields are read here — the selection never touches an
    // optional private contact object even if the backend sent one.
    onSelect({
      id: row.id,
      reference: row.reference,
      area: row.district ?? row.governorate ?? 'غير محدد',
      listingType: row.listingType,
      askingPrice: row.askingPrice,
    });
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

  const tooShort = query.trim().length < PROPERTY_SEARCH_MIN_QUERY;
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
          open && !tooShort && !searching && !error && results[active]
            ? `${id}-${active}`
            : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : snapshot?.reference ?? ''}
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
              const row = results[active];
              if (row && !tooShort && !searching && !error) choose(row.id);
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
                  results.length - 1,
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
        {tooShort && (
          <div className={styles.option} role="status">
            اكتب كود العقار أو المنطقة للبحث في البرنامج...
          </div>
        )}
        {tooShort ? null : searching && (
          <div className={styles.option} role="status">
            جارٍ البحث في العقارات...
          </div>
        )}
        {tooShort ? null : !searching && error && (
          <div className={styles.option} role="alert">
            {error} — أعد المحاولة بعد قليل.
          </div>
        )}
        {tooShort ? null : !searching && !error && !results.length && (
          <div className={styles.option} role="status">
            لا توجد نتائج مطابقة
          </div>
        )}
        {results.map((row, index) => (
          <div
            key={row.id}
            id={`${id}-${index}`}
            role="option"
            aria-selected={row.id === snapshot?.id}
            data-active={index === active}
            className={styles.option}
            onPointerMove={() => setActive(index)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              choose(row.id);
            }}
          >
            {propertySearchOptionLabel(row)}
          </div>
        ))}
      </div>
    </span>
  );
}
