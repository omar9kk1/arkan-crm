'use client';
import { useState } from 'react';
import type { PersonAssociationCategory } from '../model';
import styles from './followups.module.css';

export function PersonAssociationsPanel({
  categories,
  currentSubjectId,
  onSwitchSubject,
}: {
  categories: readonly PersonAssociationCategory[];
  currentSubjectId?: string | null;
  onSwitchSubject: (subjectId: string) => void;
}) {
  // Which category contains the currently selected subject -> expanded by default.
  const defaultExpanded = new Set<string>();
  for (const c of categories) {
    if (c.items.some((i) => i.subjectId && i.subjectId === currentSubjectId)) {
      defaultExpanded.add(c.id);
    }
  }
  const [expanded, setExpanded] =
    useState<ReadonlySet<string>>(defaultExpanded);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const emptyLabel = (label: string) => `لا توجد ${label}`;

  return (
    <div
      className={styles.associationsTab}
      role="region"
      aria-label="الارتباطات"
    >
      {categories.map((category) => {
        const isOpen = expanded.has(category.id);
        return (
          <section key={category.id} className={styles.associationCategory}>
            <button
              type="button"
              className={styles.associationCategoryRow}
              aria-expanded={isOpen}
              onClick={() => toggle(category.id)}
            >
              <span>{category.label}</span>
              <span className={styles.associationCategoryCount}>
                {category.items.length}
              </span>
              <span
                className={`${styles.associationChevron}${
                  isOpen ? ` ${styles.associationChevronOpen}` : ''
                }`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
            {isOpen &&
              (category.items.length === 0 ? (
                <p className={styles.associationEmpty}>
                  {emptyLabel(category.label)}
                </p>
              ) : (
                <ul className={styles.associationItems}>
                  {category.items.map((item) => {
                    const isActive =
                      item.subjectId && item.subjectId === currentSubjectId;
                    if (isActive) {
                      return (
                        <li key={item.key}>
                          <span
                            className={`${styles.associationItemRow} ${styles.associationItemActive}`}
                            data-current="true"
                          >
                            <span className={styles.associationItemText}>
                              <span className={styles.associationItemLabel}>
                                {item.label}
                              </span>
                              {item.secondary ? (
                                <span
                                  className={styles.associationItemSecondary}
                                  dir="auto"
                                >
                                  {item.secondary}
                                </span>
                              ) : null}
                              <span className={styles.associationItemCurrent}>
                                المتابعة الحالية
                              </span>
                            </span>
                            <span
                              className={styles.associationItemCheck}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                          </span>
                        </li>
                      );
                    }
                    if (item.subjectId) {
                      return (
                        <li key={item.key}>
                          <button
                            type="button"
                            className={styles.associationItemRow}
                            onClick={() => onSwitchSubject(item.subjectId!)}
                          >
                            <span className={styles.associationItemText}>
                              <span className={styles.associationItemLabel}>
                                {item.label}
                              </span>
                              {item.secondary ? (
                                <span
                                  className={styles.associationItemSecondary}
                                  dir="auto"
                                >
                                  {item.secondary}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={styles.associationItemChevron}
                              aria-hidden="true"
                            >
                              ←
                            </span>
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li key={item.key}>
                        <span className={styles.associationItemRowPlain}>
                          <span className={styles.associationItemText}>
                            <span className={styles.associationItemLabel}>
                              {item.label}
                            </span>
                            {item.secondary ? (
                              <span
                                className={styles.associationItemSecondary}
                                dir="auto"
                              >
                                {item.secondary}
                              </span>
                            ) : null}
                          </span>
                          <span className={styles.associationItemNone}>
                            لا يوجد موضوع متابعة
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ))}
          </section>
        );
      })}
    </div>
  );
}
