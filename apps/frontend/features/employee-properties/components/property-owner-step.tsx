import { useState } from 'react';
import { GlassCombobox } from '../../../components/ui/glass-combobox';
import {
  ownerOptions,
  type PropertyRequestDraft,
} from './property-request-model';
import styles from './property-request.module.css';
export function PropertyOwnerStep({
  draft,
  onChange,
}: {
  draft: PropertyRequestDraft;
  onChange: (draft: PropertyRequestDraft) => void;
}) {
  const owner = ownerOptions.find((o) => o.id === draft.owner.ownerId);
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={styles.panel}>
      <p>هل المالك موجود بالفعل؟</p>
      <div className={styles.types}>
        {(['NEW_OWNER', 'EXISTING_OWNER'] as const).map((mode) => (
          <button
            className={styles.choice}
            type="button"
            aria-pressed={expanded && draft.owner.mode === mode}
            aria-expanded={expanded && draft.owner.mode === mode}
            key={mode}
            onClick={() => {
              setExpanded(true);
              if (draft.owner.mode !== mode)
                onChange({
                  ...draft,
                  owner: {
                    mode,
                    ownerId: '',
                    name: '',
                    phone: '',
                    notes: draft.owner.notes,
                  },
                });
            }}
          >
            {mode === 'NEW_OWNER' ? 'مالك جديد' : 'اختيار مالك موجود'}
          </button>
        ))}
      </div>
      {expanded && draft.owner.mode === 'EXISTING_OWNER' && (
        <>
          <label className={styles.field}>
            المالك
            <GlassCombobox
              label="المالك"
              value={draft.owner.ownerId}
              options={ownerOptions.map((o) => ({
                value: o.id,
                label: o.name + ' · ' + o.phone,
              }))}
              onChange={(value) => {
                const o = ownerOptions.find((o) => o.id === value);
                onChange({
                  ...draft,
                  owner: {
                    ...draft.owner,
                    ownerId: o?.id || '',
                    name: o?.name || '',
                    phone: o?.phone || '',
                  },
                });
              }}
            />
          </label>
          {owner && (
            <p className={styles.preview}>
              {owner.name} · {owner.phone}
              <br />
              عدد العقارات: {owner.count} · آخر متابعة: {owner.lastFollowUp}
            </p>
          )}
        </>
      )}
      {expanded && draft.owner.mode === 'NEW_OWNER' && (
        <>
          <div className={styles.grid}>
            {(['name', 'phone'] as const).map((key) => (
              <label className={styles.field} key={key}>
                {key === 'name' ? 'اسم المالك' : 'رقم الهاتف'}
                <input
                  required
                  type={key === 'phone' ? 'tel' : 'text'}
                  value={draft.owner[key]}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      owner: { ...draft.owner, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label className={styles.field}>
            ملاحظات عامة
            <textarea
              value={draft.owner.notes}
              onChange={(e) =>
                onChange({
                  ...draft,
                  owner: { ...draft.owner, notes: e.target.value },
                })
              }
            />
          </label>
        </>
      )}
    </section>
  );
}
