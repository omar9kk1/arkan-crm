'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type SelectHTMLAttributes,
} from 'react';
import styles from './glass-select.module.css';

// The native control retains form values, validation and existing change handlers.
// Only its visual picker is replaced; the popover also works inside modal dialogs.
export function GlassSelect({
  children,
  onChange,
  onInvalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    root = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(''),
    [label, setLabel] = useState('');
  const [options, setOptions] = useState<
    { value: string; label: string; disabled: boolean }[]
  >([]);
  const [active, setActive] = useState(0);
  const search = useRef({ text: '', time: 0 });
  useEffect(() => {
    const el = native.current;
    if (!el) return;
    setOptions(
      Array.from(el.options, (o) => ({
        value: o.value,
        label: o.text,
        disabled: o.disabled,
      })),
    );
    setValue(el.value);
    setLabel(
      Array.from(el.labels ?? [])
        .map((l) =>
          Array.from(l.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join(' ')
            .trim(),
        )
        .join(' '),
    );
    const reset = () => requestAnimationFrame(() => setValue(el.value));
    el.form?.addEventListener('reset', reset);
    return () => el.form?.removeEventListener('reset', reset);
  }, [children, props.value, props.defaultValue]);
  useEffect(() => {
    if (!open) return;
    const popup = menu.current,
      button = trigger.current;
    if (!popup || !button) return;
    const rect = button.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12,
      above = rect.top - 12;
    const up = below < 200 && above > below;
    popup.style.width = `${Math.min(rect.width, window.innerWidth - 24)}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12))}px`;
    popup.style.maxHeight = `${Math.max(60, Math.min(280, up ? above : below))}px`;
    popup.style.top = up ? 'auto' : `${rect.bottom + 6}px`;
    popup.style.bottom = up ? `${window.innerHeight - rect.top + 6}px` : 'auto';
    popup.showPopover();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (e: Event) => {
      if (!popup.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', scroll, true);
    return () => {
      popup.hidePopover();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  const choose = (index: number) => {
    const option = options[index],
      el = native.current;
    if (!option || option.disabled || !el) return;
    el.value = option.value;
    setValue(option.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false);
    trigger.current?.focus();
  };
  const start = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value && !o.disabled),
      ),
    );
    setOpen(true);
  };
  return (
    <span className={styles.root} ref={root}>
      <select
        {...props}
        ref={native}
        className={styles.native}
        tabIndex={-1}
        aria-hidden="true"
        onFocus={() => trigger.current?.focus()}
        onInvalid={(e) => {
          e.preventDefault();
          trigger.current?.focus();
          setError(
            e.currentTarget.validationMessage || 'اختر قيمة من القائمة.',
          );
          onInvalid?.(e);
        }}
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
          onChange?.(e);
        }}
      >
        {children}
      </select>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        disabled={props.disabled}
        role="combobox"
        aria-label={props['aria-label'] || label || 'اختر'}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={
          [props['aria-describedby'], error ? `${id}-error` : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
        aria-invalid={error ? true : undefined}
        aria-required={props.required}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : start())}
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if (e.key === 'Tab') {
            setOpen(false);
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (open) choose(active);
            else start();
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const enabled = options
              .map((o, i) => (o.disabled ? -1 : i))
              .filter((i) => i >= 0);
            if (!enabled.length) return;
            const pos = enabled.indexOf(active),
              direction = e.key === 'ArrowUp' ? -1 : 1;
            const next =
              e.key === 'Home'
                ? enabled[0]
                : e.key === 'End'
                  ? enabled[enabled.length - 1]
                  : enabled[
                      (pos + direction + enabled.length) % enabled.length
                    ];
            setActive(next ?? 0);
            setOpen(true);
            return;
          }
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const now = Date.now();
            search.current = {
              text:
                (now - search.current.time < 700 ? search.current.text : '') +
                e.key,
              time: now,
            };
            const index = options.findIndex(
              (o) => !o.disabled && o.label.startsWith(search.current.text),
            );
            if (index >= 0) {
              setActive(index);
              setOpen(true);
            }
          }
        }}
      >
        <span>{options.find((o) => o.value === value)?.label || 'اختر'}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <div
        ref={menu}
        id={id}
        popover="manual"
        role="listbox"
        aria-label={props['aria-label'] || label || 'الخيارات'}
        className={styles.menu}
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((option, index) => (
          <div
            key={`${option.value}-${index}`}
            id={`${id}-${index}`}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled}
            data-active={index === active}
            className={styles.option}
            onPointerMove={() => {
              if (!option.disabled) setActive(index);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              choose(index);
            }}
          >
            {option.label}
          </div>
        ))}
      </div>
      {error && (
        <span id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
