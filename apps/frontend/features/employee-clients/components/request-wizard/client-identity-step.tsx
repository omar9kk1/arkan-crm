import { useState } from 'react';
import { GlassCombobox } from '../../../../components/ui/glass-combobox';
import type { EmployeeClient } from '../../client-model';
import {
  initialBundle,
  selectClient,
  type ClientRequestBundle,
} from './client-request-bundle';
import styles from './unified-request.module.css';
export function ClientIdentityStep({
  bundle,
  onChange,
  clients,
}: {
  bundle: ClientRequestBundle;
  onChange: (b: ClientRequestBundle) => void;
  clients: readonly EmployeeClient[];
}) {
  const selected = clients.find((c) => c.id === bundle.clientId);
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={styles.panel}>
      <div className={styles.types}>
        {(['NEW_CLIENT', 'EXISTING_CLIENT'] as const).map((mode) => (
          <button
            type="button"
            className={styles.choice}
            key={mode}
            aria-pressed={expanded && bundle.mode === mode}
            aria-expanded={expanded && bundle.mode === mode}
            onClick={() => {
              setExpanded(true);
              if (mode !== bundle.mode) onChange({ ...initialBundle(), mode });
            }}
          >
            {mode === 'NEW_CLIENT' ? 'عميل جديد' : 'اختيار عميل موجود'}
          </button>
        ))}
      </div>
      {expanded &&
        (bundle.mode === 'EXISTING_CLIENT' ? (
          <>
            <label className={styles.field}>
              العميل
              <GlassCombobox
                label="العميل"
                value={bundle.clientId}
                options={clients.map((c) => ({
                  value: c.id,
                  label: c.name + ' · ' + c.phone,
                }))}
                onChange={(value) => {
                  const c = clients.find((c) => c.id === value);
                  onChange(
                    c
                      ? selectClient(c)
                      : { ...initialBundle(), mode: 'EXISTING_CLIENT' },
                  );
                }}
              />
            </label>
            {selected && (
              <p className={styles.preview}>
                {selected.name} · {selected.phone}
                <br />
                {selected.type} · المتابعة القادمة:{' '}
                {selected.next || 'لم تُحدد'}
              </p>
            )}
          </>
        ) : (
          <>
            <div className={styles.grid}>
              <label className={styles.field}>
                اسم العميل
                <input
                  required
                  value={bundle.name}
                  onChange={(e) =>
                    onChange({ ...bundle, name: e.target.value })
                  }
                />
              </label>
              <label className={styles.field}>
                رقم الهاتف
                <input
                  required
                  type="tel"
                  value={bundle.phone}
                  onChange={(e) =>
                    onChange({ ...bundle, phone: e.target.value })
                  }
                />
              </label>
            </div>
            <label className={styles.field}>
              ملاحظات عامة
              <textarea
                value={bundle.notes}
                onChange={(e) => onChange({ ...bundle, notes: e.target.value })}
              />
            </label>
          </>
        ))}
    </section>
  );
}
