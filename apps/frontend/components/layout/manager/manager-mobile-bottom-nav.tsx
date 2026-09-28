'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { ManagerNavItem } from './manager-nav-item';
import { primaryNavigation, moreNavigation } from './navigation';
import styles from './manager-shell.module.css';
export function ManagerMobileBottomNav() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 981px)');
    const closeOnDesktop = () => {
      if (desktop.matches) dialog.current?.close();
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  return (
    <>
      <nav className={styles.bottomNav} aria-label="تنقل المدير على الهاتف">
        {primaryNavigation.map((item) => (
          <ManagerNavItem key={item.id} item={item} compact />
        ))}
        <button
          ref={trigger}
          type="button"
          className={styles.navItem}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="manager-more"
          onClick={() => {
            dialog.current?.showModal();
            setOpen(true);
          }}
        >
          <Icon name="more" />
          <span>المزيد</span>
        </button>
      </nav>
      <dialog
        ref={dialog}
        id="manager-more"
        aria-labelledby="manager-more-title"
        className={styles.moreDialog}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className={styles.moreContent}>
          <header className={styles.moreHeader}>
            <div>
              <h2 id="manager-more-title">المزيد</h2>
              <p>أقسام الإدارة والمتابعة</p>
            </div>
            <Button
              variant="ghost"
              aria-label="إغلاق المزيد"
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </Button>
          </header>
          <nav aria-label="أقسام المدير الإضافية" className={styles.moreItems}>
            {moreNavigation.map((item) => (
              <ManagerNavItem key={item.id} item={item} />
            ))}
          </nav>
        </div>
      </dialog>
    </>
  );
}
