'use client';
// Owner/broker contacts now come from the backend `GET /contacts`.
//
// This module used to hold an in-memory, per-browser registry seeded with demo
// records. That store is gone: the backend is the source of truth, ownership is
// derived server-side from the authenticated user, and what a viewer may see is
// decided by the authorized response — never by a client-side filter.
//
// The mapping to `RegistryContact` keeps the existing Clients/Wizard screens
// working unchanged. Two fields are deliberately left empty because the
// contract does not expose them: the responsible employee's display name, and
// the list of properties linked to a contact. See docs/reports.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Role, type AuthUser } from '@arkan/shared';
import { listContacts } from './api/contacts-api';
import type { ContactDto, ContactTypeApi } from './api/property-types';

export type ContactType = ContactTypeApi;
export type ContactMode = 'EXISTING' | 'NEW';
/** EMPLOYEE = owned by a specific employee; COMPANY = no responsible employee. */
export type ContactScope = 'COMPANY' | 'EMPLOYEE';

export interface RegistryContact {
  id: string;
  type: ContactType;
  name: string;
  phone: string;
  scope: ContactScope;
  /** `responsibleUserId`, '' when the record carries none. */
  ownerUserId: string;
  /** Not exposed by the API; kept empty rather than filled with a guess. */
  ownerName: string;
  /** Not exposed by the API; kept empty rather than filled with a guess. */
  propertyIds: string[];
  propertyCodes: string[];
  notes: string;
  createdAt: string;
}

/** Maps one authorized backend row onto the shape the existing screens read. */
export function toRegistryContact(dto: ContactDto): RegistryContact {
  return {
    id: dto.id,
    type: dto.type,
    name: dto.name,
    phone: dto.phone,
    scope: dto.responsibleUserId ? 'EMPLOYEE' : 'COMPANY',
    ownerUserId: dto.responsibleUserId ?? '',
    ownerName: '',
    propertyIds: [],
    propertyCodes: [],
    notes: dto.notes ?? '',
    createdAt: dto.createdAt ? dto.createdAt.slice(0, 10) : '',
  };
}

/** Digits-only phone in Latin numerals, used for matching/suggestions. */
export function normalizePhone(value: string): string {
  return (value || '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D/g, '');
}

export function contactLabel(contact: { name: string; phone: string }): string {
  return `${contact.name} · ${contact.phone}`;
}

/** Finds the first contact of a pool whose phone matches. */
export function findContactByPhone(
  type: ContactType,
  phone: string,
  pool: RegistryContact[],
): RegistryContact | undefined {
  const target = normalizePhone(phone);
  if (!target) return undefined;
  return pool
    .filter((contact) => contact.type === type)
    .find((contact) => normalizePhone(contact.phone) === target);
}

/**
 * Display-level guard that mirrors the backend rule: a manager may see every
 * contact; an employee sees only records the backend attributed to them. The
 * server already filters `GET /contacts`, so this never *grants* access — it
 * only avoids rendering a field the response did not carry.
 */
export function canViewContact(
  user: AuthUser | null,
  contact: RegistryContact,
): boolean {
  if (!user) return false;
  if (user.role === Role.MANAGER) return true;
  return !!contact.ownerUserId && contact.ownerUserId === user.id;
}

export interface ContactsResource {
  contacts: RegistryContact[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const CONTACTS_PAGE_SIZE = 100;

/**
 * Loads contacts from `GET /contacts` (optionally of one type).
 *
 * Requests are aborted on unmount and a late response can never overwrite a
 * newer one. Failures are surfaced to the caller instead of silently falling
 * back to cached/demo records.
 */
export function useContacts(type?: ContactType): ContactsResource {
  const [contacts, setContacts] = useState<RegistryContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listContacts({ type, limit: CONTACTS_PAGE_SIZE })
      .then((page) => {
        if (!active || controller.signal.aborted) return;
        setContacts(page.items.map(toRegistryContact));
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setContacts([]);
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'تعذر تحميل السجلات.');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [type, nonce]);

  return useMemo(
    () => ({ contacts, loading, error, refresh }),
    [contacts, loading, error, refresh],
  );
}

/**
 * Contacts of a type the viewer is authorized to see. The signature is kept so
 * the wizard and the Clients pages did not need to change shape.
 */
export function useVisibleContacts(
  user: AuthUser | null,
  type: ContactType,
): RegistryContact[] {
  const { contacts } = useContacts(type);
  return useMemo(
    () => contacts.filter((contact) => canViewContact(user, contact)),
    [contacts, user],
  );
}

/**
 * Every contact the viewer may see (both types), as a plain array. Used by the
 * manager Clients page, which lists owners and brokers together.
 */
export function useContactList(): RegistryContact[] {
  const { contacts } = useContacts();
  return contacts;
}

/** Resource form (loading/error/refresh) for screens that render their own states. */
export function useRegistryContacts(): ContactsResource {
  return useContacts();
}
