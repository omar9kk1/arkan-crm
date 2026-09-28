import { GlassSelect } from '../../../components/ui/glass-select';
import { SearchBar } from '../../../components/ui/search-bar';
import { movementLabels, type FinanceFilter } from '../finance-model';
import styles from './finance.module.css';
export function FinanceFilters({
  value,
  parties,
  onChange,
}: {
  value: FinanceFilter;
  parties: readonly string[];
  onChange: (filter: FinanceFilter) => void;
}) {
  return (
    <div className={styles.filters}>
      <label className={styles.field}>
        الفترة
        <GlassSelect
          value={value.period}
          onChange={(event) =>
            onChange({
              ...value,
              period: event.target.value as FinanceFilter['period'],
            })
          }
        >
          <option value="today">اليوم</option>
          <option value="week">آخر 7 أيام</option>
          <option value="month">الشهر الحالي</option>
          <option value="all">كل الوقت</option>
        </GlassSelect>
      </label>
      <label className={styles.field}>
        نوع الحركة
        <GlassSelect
          value={value.type}
          onChange={(event) =>
            onChange({
              ...value,
              type: event.target.value as FinanceFilter['type'],
            })
          }
        >
          <option value="all">الكل</option>
          {Object.entries(movementLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </GlassSelect>
      </label>
      <label className={styles.field}>
        الموظف أو الطرف
        <GlassSelect
          value={value.party}
          onChange={(event) =>
            onChange({ ...value, party: event.target.value })
          }
        >
          <option value="">كل الأطراف</option>
          {parties.map((party) => (
            <option key={party}>{party}</option>
          ))}
        </GlassSelect>
      </label>
      <SearchBar
        label="بحث باسم العقار أو الصفقة أو الموظف"
        placeholder="ابحث باسم العقار أو الصفقة أو الموظف..."
        value={value.query}
        onChange={(event) => onChange({ ...value, query: event.target.value })}
      />
    </div>
  );
}
