'use client';

import { useEffect, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import {
  listManagers,
  setEmployeeActivation,
  setManagerPermissions,
} from '../../../lib/api/employees-api';
import type { ManagerDto } from '../../../lib/api/employee-types';
import styles from './employees.module.css';

/**
 * OWNER-only «المديرين» tab. Every manager is an expandable card with the
 * employees currently assigned to them, live review capabilities and account
 * state. All writes still pass through the OWNER-only backend endpoints.
 */
export function OwnerManagersTab({
  refreshKey,
  onChanged,
  onCreateManager,
}: {
  refreshKey: number;
  onChanged: () => void;
  onCreateManager: () => void;
}) {
  const [managers, setManagers] = useState<ManagerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listManagers()
      .then((page) => {
        if (active) setManagers(page.items);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'تعذر تحميل المديرين.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const togglePermission = async (
    manager: ManagerDto,
    key: 'canApprove' | 'canReject',
  ) => {
    setBusy(`${manager.id}:${key}`);
    setError('');
    try {
      const updated = await setManagerPermissions(manager.id, {
        canApprove:
          key === 'canApprove'
            ? !manager.capabilities.approveProperties
            : manager.capabilities.approveProperties,
        canReject:
          key === 'canReject'
            ? !manager.capabilities.rejectProperties
            : manager.capabilities.rejectProperties,
      });
      setManagers((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'تعذر حفظ الصلاحية.',
      );
    } finally {
      setBusy('');
    }
  };

  const toggleActive = async (manager: ManagerDto) => {
    setBusy(`${manager.id}:active`);
    setError('');
    try {
      const updated = await setEmployeeActivation(
        manager.id,
        !manager.isActive,
      );
      setManagers((previous) =>
        previous.map((item) =>
          item.id === updated.id
            ? { ...item, isActive: updated.isActive }
            : item,
        ),
      );
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذر تغيير حالة المدير.',
      );
    } finally {
      setBusy('');
    }
  };

  return (
    <section className={styles.tabSection}>
      {error && <p role="alert">{error}</p>}
      {loading && <p className={styles.notice}>جارٍ تحميل المديرين…</p>}
      {!loading && !error && !managers.length && (
        <Card className={styles.emptyState}>
          <h2>لا يوجد مديرون بعد</h2>
          <p className={styles.muted}>
            أنشئ أول مدير، ثم عيّن له الموظفين من تبويب «الموظفين». صلاحيات
            الاعتماد والرفض تبقى معطلة حتى تمنحها له.
          </p>
          <Button type="button" onClick={onCreateManager}>
            إضافة مدير
          </Button>
        </Card>
      )}
      {!loading && managers.length > 0 && (
        <div className={styles.managerList}>
          {managers.map((manager) => {
            const expanded = expandedId === manager.id;
            const team = manager.team;
            return (
              <Card key={manager.id} className={styles.managerCard}>
                <button
                  type="button"
                  className={styles.managerHeader}
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedId(expanded ? null : manager.id)
                  }
                >
                  <span className={styles.avatar} aria-hidden="true">
                    {manager.name.slice(0, 1)}
                  </span>
                  <span className={styles.managerIdentity}>
                    <strong>{manager.name}</strong>
                    <span className={styles.muted}>
                      مدير النظام • {manager.teamCount} موظف
                    </span>
                  </span>
                  <span
                    className={
                      manager.isActive
                        ? styles.statusActive
                        : styles.statusInactive
                    }
                  >
                    {manager.isActive ? 'نشط' : 'غير نشط'}
                  </span>
                  <span className={styles.managerChevron} aria-hidden="true">
                    {expanded ? '−' : '+'}
                  </span>
                </button>
                {expanded && (
                  <div className={styles.managerBody}>
                    <div className={styles.teamList}>
                      <h3>الموظفون المعيّنون</h3>
                      {team.length ? (
                        <ul className={styles.list}>
                          {team.map((employee) => (
                            <li key={employee.id}>
                              <strong>{employee.name}</strong>
                              <span className={styles.muted}>
                                {' '}
                                — {employee.isActive ? 'نشط' : 'غير نشط'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.muted}>
                          لا يوجد موظفون معيّنون لهذا المدير.
                        </p>
                      )}
                    </div>
                    <div className={styles.permissions}>
                      <h3>صلاحيات المراجعة</h3>
                      <label>
                        <input
                          type="checkbox"
                          role="switch"
                          className={styles.permissionSwitch}
                          checked={manager.capabilities.approveProperties}
                          disabled={busy === `${manager.id}:canApprove`}
                          onChange={() =>
                            void togglePermission(manager, 'canApprove')
                          }
                        />
                        اعتماد العقارات
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          role="switch"
                          className={styles.permissionSwitch}
                          checked={manager.capabilities.rejectProperties}
                          disabled={busy === `${manager.id}:canReject`}
                          onChange={() =>
                            void togglePermission(manager, 'canReject')
                          }
                        />
                        رفض العقارات
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          role="switch"
                          className={styles.permissionSwitch}
                          checked={manager.isActive}
                          disabled={busy === `${manager.id}:active`}
                          onChange={() => void toggleActive(manager)}
                        />
                        الحساب نشط
                      </label>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
