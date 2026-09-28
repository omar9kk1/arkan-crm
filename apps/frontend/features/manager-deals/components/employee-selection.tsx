'use client';
import { GlassSelect } from '../../../components/ui/glass-select';

import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { employees } from '../mock-data';
import styles from './deals.module.css';
export function EmployeeSelection({
  suggested,
  value,
  confirmed,
  onChange,
  onConfirm,
  label,
}: {
  suggested: string;
  value: string;
  confirmed: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  label: string;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <div className={styles.notice}>
      <p>
        {label}: <strong>{suggested}</strong>
      </p>
      {choosing && (
        <label className={styles.field}>
          اختيار موظف آخر
          <GlassSelect
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {employees.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </GlassSelect>
        </label>
      )}
      <div className={styles.actions}>
        <Button type="button" onClick={onConfirm}>
          {confirmed ? `تم اعتماد ${value}` : 'اعتماد الموظف'}
        </Button>
        <Button
          type="button"
          aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          اختيار موظف آخر
        </Button>
      </div>
    </div>
  );
}
