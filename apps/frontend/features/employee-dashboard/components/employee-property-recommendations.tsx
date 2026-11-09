'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { listClientRecommendationCandidates } from '../../../lib/api/clients-api';
import { listProperties } from '../../../lib/api/properties-api';
import type { ClientRecommendationCandidateApiDto } from '../../../lib/api/client-types';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import { parseStoredRequestData } from '../../employee-clients/components/request-wizard/client-request-model';
import type { ClientType } from '../../employee-clients/components/request-wizard/client-request-model';

import styles from './employee-dashboard.module.css';

interface MatchReason {
  key: string;
  label: string;
}

interface Recommendation {
  key: string;
  property: PropertyViewDto;
  client: ClientRecommendationCandidateApiDto;
  requestType: ClientType;
  reasons: MatchReason[];
  unknowns: string[];
}

const CLIENT_TYPE_TO_DEAL: Record<ClientType, 'SALE' | 'RENT' | 'EXCHANGE'> = {
  BUYER: 'SALE',
  RENTER: 'RENT',
  EXCHANGER: 'EXCHANGE',
};

function normalizeArea(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function areaMatches(requestArea: string, property: PropertyViewDto): boolean {
  const req = normalizeArea(requestArea);
  if (!req) return false;
  const propArea = normalizeArea(property.district ?? property.governorate);
  if (!propArea) return false;
  // request area may be multiple tokens separated by spaces
  const tokens = req.split(/\s+/).filter(Boolean);
  return tokens.some((t) => t.length >= 2 && propArea.includes(t));
}

function buildRecommendations(
  clients: ClientRecommendationCandidateApiDto[],
  properties: PropertyViewDto[],
): Recommendation[] {
  const availableProps = properties.filter((p) => p.status === 'AVAILABLE');
  const out: Recommendation[] = [];
  const seen = new Set<string>();

  for (const client of clients) {
    const parsed = parseStoredRequestData(client.requestData);
    if (!parsed) continue;
    for (const type of parsed.types) {
      const req = parsed.requests[type];
      const desired = req?.requestDetails?.desiredProperty;
      if (!req || !desired) continue;
      const desiredOp = CLIENT_TYPE_TO_DEAL[type];
      const budgetRaw = desired.budget;
      const budget = budgetRaw ? Number(budgetRaw) : NaN;
      const budgetToRaw = desired.budgetTo;
      const budgetTo = budgetToRaw ? Number(budgetToRaw) : NaN;
      const upperBudget =
        Number.isFinite(budgetTo) && budgetTo > 0 ? budgetTo : budget;

      for (const property of availableProps) {
        if (property.listingType !== desiredOp) continue; // no mixing sale/rental

        const reasons: MatchReason[] = [];
        const unknowns: string[] = [];

        // intent (always, since we filtered)
        reasons.push({ key: 'intent', label: 'نوع العملية مناسب' });

        // area
        const areaOk = areaMatches(
          desired.area || desired.governorate,
          property,
        );
        if (areaOk) reasons.push({ key: 'area', label: 'نفس المنطقة' });
        else if (desired.area || desired.governorate) {
          // request specified area but no match -> not a verified reason, skip chip
        } else {
          unknowns.push('المنطقة غير محددة في الطلب');
        }

        // budget
        const price = property.askingPrice ? Number(property.askingPrice) : NaN;
        if (Number.isFinite(upperBudget) && upperBudget > 0) {
          if (Number.isFinite(price) && price > 0) {
            if (price <= upperBudget) {
              reasons.push({ key: 'budget', label: 'ضمن الميزانية' });
            } else {
              unknowns.push('السعر أعلى من الميزانية');
            }
          } else {
            unknowns.push('سعر العقار غير متوفر');
          }
        } else {
          unknowns.push('الميزانية غير محددة في الطلب');
        }

        // propertyType (only if request specifies and property title contains it)
        if (desired.propertyType) {
          const pt = desired.propertyType.toLowerCase();
          const title = (property.title ?? '').toLowerCase();
          const desc = (property.description ?? '').toLowerCase();
          if (title.includes(pt) || desc.includes(pt)) {
            reasons.push({ key: 'type', label: 'نوع العقار مناسب' });
          } else {
            // not verified -> don't claim
          }
        } else {
          unknowns.push('نوع العقار غير محدد في الطلب');
        }

        // require at least one verified additional reason beyond intent
        const additional = reasons.filter((r) => r.key !== 'intent');
        if (additional.length === 0) continue;

        const key = `${property.id}::${client.id}::${type}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          key,
          property,
          client,
          requestType: type,
          reasons,
          unknowns,
        });
      }
    }
  }

  // rank by number of verified reasons desc
  out.sort((a, b) => b.reasons.length - a.reasons.length);
  return out;
}

function formatPrice(value: string | null): string {
  if (!value) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return `${Math.round(n).toLocaleString('ar-KW')} د.ك`;
}

export function EmployeePropertyRecommendations() {
  const [clients, setClients] = useState<ClientRecommendationCandidateApiDto[]>([]);
  const [properties, setProperties] = useState<PropertyViewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Recommendation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, pRes] = await Promise.all([
        listClientRecommendationCandidates(),
        listProperties({ status: 'AVAILABLE', limit: 50 }),
      ]);
      setClients(cRes.items);
      setProperties(pRes.items);
    } catch {
      setError('تعذّر تحميل الترشيحات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recs = useMemo(
    () => buildRecommendations(clients, properties),
    [clients, properties],
  );
  const visible = recs.slice(0, 4);

  return (
    <section className={styles.recsSection}>
      <h2 className={styles.recsTitle}>العقارات المناسبة لعملائك</h2>
      {loading ? (
        <div className={styles.recsList}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.recSkeleton} />
          ))}
        </div>
      ) : error ? (
        <Card>
          <p className={styles.recsEmpty}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      ) : recs.length === 0 ? (
        <Card>
          <p className={styles.recsEmpty}>لا توجد ترشيحات موثوقة حالياً</p>
        </Card>
      ) : (
        <>
          <div className={styles.recsList}>
            {visible.map((r) => (
              <article key={r.key} className={styles.recCard}>
                <div className={styles.recHead}>
                  <span className={styles.recTitle}>{r.property.title}</span>
                  <span className={styles.recCode} dir="ltr">
                    {r.property.reference}
                  </span>
                </div>
                <span className={styles.recPrice} dir="ltr">
                  {formatPrice(r.property.askingPrice)}
                </span>
                <span className={styles.recLocation}>
                  {r.property.district ?? r.property.governorate ?? '—'}
                </span>
                <span className={styles.recClient}>
                  مناسب لطلب: {r.client.name}
                </span>
                <div className={styles.recChips}>
                  {r.reasons
                    .filter((x) => x.key !== 'intent')
                    .map((x) => (
                      <span key={x.key} className={styles.recChip}>
                        {x.label}
                      </span>
                    ))}
                </div>
                <Button compactOnMobile onClick={() => setDetails(r)}>
                  تفاصيل الترشيح
                </Button>
              </article>
            ))}
          </div>
          {recs.length > 4 ? (
            <p className={styles.recsMore}>{recs.length - 4} ترشيحات إضافية</p>
          ) : null}
        </>
      )}

      {details ? (
        <div className={styles.recOverlay}>
          <Card>
            <h3 className={styles.recOverlayTitle}>تفاصيل الترشيح</h3>
            <p className={styles.recOverlayLine}>
              العقار: {details.property.title} ({details.property.reference})
            </p>
            <p className={styles.recOverlayLine}>
              العميل: {details.client.name}
            </p>
            <p className={styles.recOverlayLine}>
              الطلب:{' '}
              {details.requestType === 'BUYER'
                ? 'شراء'
                : details.requestType === 'RENTER'
                  ? 'إيجار'
                  : 'تبادل'}
            </p>
            <p className={styles.recOverlayLine}>معيارات مطابقة:</p>
            <ul className={styles.recOverlayList}>
              {details.reasons.map((x) => (
                <li key={x.key}>{x.label}</li>
              ))}
            </ul>
            {details.unknowns.length > 0 ? (
              <>
                <p className={styles.recOverlayLine}>غير مُتحقق:</p>
                <ul className={styles.recOverlayList}>
                  {details.unknowns.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <Button onClick={() => setDetails(null)}>إغلاق</Button>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
