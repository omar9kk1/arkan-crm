import { GlassCombobox } from '../../../components/ui/glass-combobox';
import { FloorDetails } from '../../employee-clients/components/request-wizard/floor-details';
import { GlassSelect } from '../../../components/ui/glass-select';
import {
  districtOptions,
  blocksForArea,
  governorateForArea,
} from '../../../lib/area-governorate';
import {
  fieldLabels,
  type ParsedPropertyData,
  type PropertyOfferType,
} from './property-request-model';
import styles from './property-request.module.css';
export function PropertyDataEditor({
  data,
  onChange,
  offerType,
  desired = false,
}: {
  data: ParsedPropertyData;
  onChange: (value: ParsedPropertyData) => void;
  offerType: PropertyOfferType;
  desired?: boolean;
}) {
  const blocks = blocksForArea(data.area);
  const title = desired
    ? 'بيانات العقار المطلوب للبدل'
    : offerType === 'EXCHANGE'
      ? 'بيانات عقار المالك الحالي'
      : offerType === 'SALE'
        ? 'بيانات العقار المعروض للبيع'
        : 'بيانات العقار المعروض للإيجار';
  return (
    <section
      className={`${styles.panel} ${desired ? styles.desiredPanel : ''}`}
    >
      <h3>{title}</h3>
      <div className={styles.grid}>
        {(Object.keys(fieldLabels) as (keyof typeof fieldLabels)[])
          .filter((key) => key !== 'street' && key !== 'frontage')
          .filter((key) => !['description', 'notes'].includes(key))
          .sort((a, b) => Number(b === 'block') - Number(a === 'block'))
          .filter((key) =>
            desired
              ? ![
                  'operationType',
                  'block',
                  'street',
                  'frontage',
                  'duration',
                ].includes(key)
              : key === 'duration'
                ? offerType === 'RENT'
                : key === 'operationType'
                  ? offerType !== 'EXCHANGE'
                  : true,
          )
          .map((key) => {
            if (key === 'roomsOrFloor')
              return (
                <FloorDetails
                  key={key}
                  floors={data.floors || []}
                  onChange={(floors) => onChange({ ...data, floors })}
                />
              );
            const label =
              key === 'price'
                ? desired
                  ? 'فرق البدل المتوقع'
                  : offerType === 'RENT'
                    ? 'الإيجار الشهري'
                    : offerType === 'EXCHANGE'
                      ? 'السعر التقريبي'
                      : 'السعر المطلوب'
                : key === 'description' && desired
                  ? 'المواصفات المطلوبة'
                  : fieldLabels[key];
            return (
              <label
                className={`${styles.field} ${key === 'description' || key === 'notes' ? styles.wideField : ''}`}
                key={key}
              >
                {label}
                {key === 'block' ? (
                  <GlassSelect
                    value={data.block}
                    disabled={!blocks.length}
                    onChange={(e) =>
                      onChange({ ...data, block: e.target.value })
                    }
                  >
                    <option value="">
                      {blocks.length ? 'اختر القطعة' : 'اختر المنطقة أولًا'}
                    </option>
                    {data.block && !blocks.includes(data.block) && (
                      <option value={data.block} disabled>
                        {data.block} — اختر قطعة من القائمة
                      </option>
                    )}
                    {blocks.map((block) => (
                      <option key={block} value={block}>
                        {block}
                      </option>
                    ))}
                  </GlassSelect>
                ) : key === 'area' ? (
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
                        block: area === data.area ? data.block : '',
                        governorate: governorateForArea(area),
                      })
                    }
                  />
                ) : key === 'propertyType' ? (
                  <GlassSelect
                    value={data.propertyType}
                    onChange={(e) =>
                      onChange({ ...data, propertyType: e.target.value })
                    }
                  >
                    <option value="">اختر نوع العقار</option>
                    {data.propertyType &&
                      !['قسيمة', 'فيلا'].includes(data.propertyType) && (
                        <option value={data.propertyType} disabled>
                          {data.propertyType} — اختر قسيمة أو فيلا
                        </option>
                      )}
                    <option value="قسيمة">قسيمة</option>
                    <option value="فيلا">فيلا</option>
                  </GlassSelect>
                ) : key === 'operationType' ? (
                  <GlassSelect
                    value={data[key]}
                    onChange={(e) =>
                      onChange({ ...data, [key]: e.target.value })
                    }
                  >
                    <option>{data.operationType}</option>
                  </GlassSelect>
                ) : key === 'description' || key === 'notes' ? (
                  <textarea
                    value={data[key]}
                    onChange={(e) =>
                      onChange({ ...data, [key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    value={data[key]}
                    type={key === 'price' || key === 'size' ? 'number' : 'text'}
                    min={key === 'price' || key === 'size' ? '0' : undefined}
                    step={key === 'price' || key === 'size' ? 'any' : undefined}
                    inputMode={
                      key === 'price' || key === 'size' ? 'decimal' : undefined
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
