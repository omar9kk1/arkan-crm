import { GlassCombobox } from '../../../../components/ui/glass-combobox';
import { GlassSelect } from '../../../../components/ui/glass-select';
import { fieldLabels, type ParsedRequestData } from './client-request-model';
import styles from './unified-request.module.css';
import { FloorDetails } from './floor-details';
import {
  districtOptions,
  governorateForArea,
} from '../../../../lib/area-governorate';

export function RequestDetailsEditor({
  title,
  data,
  onChange,
  current = false,
  exchange = false,
}: {
  title: string;
  data: ParsedRequestData;
  onChange: (value: ParsedRequestData) => void;
  current?: boolean;
  exchange?: boolean;
}) {
  return (
    <section
      className={`${styles.panel} ${exchange ? styles.desiredPanel : ''}`}
    >
      <h3>{title}</h3>
      <div className={styles.grid}>
        {(Object.keys(fieldLabels) as (keyof typeof fieldLabels)[])
          .filter(
            (key) => !['specifications', 'notes', 'budgetTo'].includes(key),
          )
          .filter((key) => key !== 'duration' || data.operationType === 'إيجار')
          .map((key) => {
            if (key === 'size' && !current) return null;
            if (key === 'budget' && !current)
              return (
                <div key={key} className={styles.wideField}>
                  <div className={styles.budgetRow}>
                    {(['budget', 'budgetTo'] as const).map((bound) => (
                      <label key={bound} className={styles.field}>
                        {data.operationType === 'إيجار'
                          ? 'الميزانية الشهرية'
                          : 'الميزانية'}{' '}
                        {bound === 'budget' ? 'من' : 'إلى'}
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={data[bound] || ''}
                          onChange={(e) =>
                            onChange({ ...data, [bound]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <label className={styles.field}>
                      المساحة
                      <input
                        inputMode="decimal"
                        value={data.size}
                        onChange={(e) =>
                          onChange({ ...data, size: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            if (key === 'roomsOrFloor')
              return (
                <FloorDetails
                  key={key}
                  floors={data.floors || []}
                  onChange={(floors) => onChange({ ...data, floors })}
                />
              );
            const label =
              key === 'budget'
                ? current
                  ? 'السعر التقريبي'
                  : exchange
                    ? 'الميزانية أو فرق البدل المتوقع'
                    : data.operationType === 'إيجار'
                      ? 'الميزانية الشهرية'
                      : 'الميزانية'
                : key === 'specifications' && current
                  ? 'وصف العقار'
                  : fieldLabels[key];
            return (
              <label
                className={`${styles.field} ${key === 'specifications' || key === 'notes' ? styles.wideField : ''}`}
                key={key}
              >
                {label}
                {key === 'area' ? (
                  <GlassCombobox
                    label="المنطقة"
                    placeholder="ابحث واختر المنطقة..."
                    value={data.area}
                    options={
                      data.area &&
                      !districtOptions.some(
                        (option) => option.value === data.area,
                      )
                        ? [
                            { value: data.area, label: data.area },
                            ...districtOptions,
                          ]
                        : districtOptions
                    }
                    onChange={(area) =>
                      onChange({
                        ...data,
                        area,
                        governorate: governorateForArea(area),
                      })
                    }
                  />
                ) : key === 'operationType' ? (
                  <GlassSelect
                    value={data[key]}
                    onChange={(e) =>
                      onChange({ ...data, [key]: e.target.value })
                    }
                  >
                    {(current
                      ? ['بيع', 'إيجار', 'بدل']
                      : exchange
                        ? ['بدل']
                        : [data.operationType]
                    ).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </GlassSelect>
                ) : key === 'notes' || key === 'specifications' ? (
                  <textarea
                    value={data[key]}
                    onChange={(e) =>
                      onChange({ ...data, [key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    value={data[key]}
                    inputMode={
                      key === 'budget' || key === 'size' ? 'decimal' : undefined
                    }
                    onChange={(e) =>
                      onChange({
                        ...data,
                        [key]: e.target.value,
                      })
                    }
                  />
                )}
              </label>
            );
          })}
      </div>
    </section>
  );
}
