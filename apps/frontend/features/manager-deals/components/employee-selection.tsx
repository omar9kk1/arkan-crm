'use client';
import { GlassSelect } from '../../../components/ui/glass-select';

import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import type { DealEmployeeOption } from '../deal-model';
import styles from './deals.module.css';
export function EmployeeSelection({
  suggested,
  options,
  value,
  confirmed,
  onChange,
  onConfirm,
  label,
  allowOverride = true,
  showConfirm = true,
}: {
  suggested: string;
  options: DealEmployeeOption[];
  value: string;
  confirmed: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  label: string;
  /** Property/client employee override is OWNER-only. */
  allowOverride?: boolean;
  /** MANAGER attribution is confirmed automatically, so the button is hidden. */
  showConfirm?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const selectedName =
    options.find((employee) => employee.userId === value)?.name ?? '';
  return (
    <div className={styles.notice}>
      <p>
        {label}: <strong>{suggested}</strong>
      </p>
      {choosing && (
        <label className={styles.field}>
          الموظف المسؤول
          <GlassSelect
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {options.map((employee) => (
              <option key={employee.userId} value={employee.userId}>
                {employee.name}
              </option>
            ))}
          </GlassSelect>
        </label>
      )}
      {(showConfirm || allowOverride) && (
        <div className={styles.actions}>
          {showConfirm && (
            <Button type="button" onClick={onConfirm} disabled={!value}>
              {confirmed && selectedName
                ? `تم اعتماد ${selectedName}`
                : 'اعتماد الموظف'}
            </Button>
          )}
          {allowOverride && (
            <Button
              type="button"
              aria-expanded={choosing}
              onClick={() => setChoosing(!choosing)}
            >
              اختيار موظف آخر
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
