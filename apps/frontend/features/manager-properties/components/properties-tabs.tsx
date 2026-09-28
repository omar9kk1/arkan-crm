'use client';
import { useRef } from 'react';
import styles from './properties.module.css';
export function PropertiesTabs({
  id,
  label,
  items,
  value,
  onChange,
  className = '',
}: {
  id: string;
  label: string;
  items: readonly { id: string; label: string; count?: number }[];
  className?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className={`${styles.tabs} ${className}`}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel-${item.id}`}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === 'ArrowLeft') next = (index + 1) % items.length;
            else if (event.key === 'ArrowRight')
              next = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = items.length - 1;
            else return;
            event.preventDefault();
            const nextItem = items[next];
            if (!nextItem) return;
            onChange(nextItem.id);
            refs.current[next]?.focus();
          }}
        >
          {item.label}
          {item.count !== undefined && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
