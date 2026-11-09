import { useId, type ReactNode } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import styles from './settings.module.css';
export function SettingsSectionCard({
  title,
  children,
  onSave,
  readOnly = false,
}: {
  title: string;
  children: ReactNode;
  onSave?: () => void;
  /** Renders the fields disabled, without a save action. */
  readOnly?: boolean;
}) {
  const id = useId();
  return (
    <Card className={styles.section} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {onSave ? (
        <form
          aria-labelledby={id}
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className={styles.fields}>{children}</div>
          <Button type="submit">حفظ التغييرات</Button>
        </form>
      ) : readOnly ? (
        <fieldset className={styles.readOnly} disabled>
          {children}
        </fieldset>
      ) : (
        children
      )}
    </Card>
  );
}
