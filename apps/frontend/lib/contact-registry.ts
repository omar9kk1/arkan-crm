'use client';
// Owner/broker contacts now come from the backend `GET /contacts`.
//
// This module used to hold an in-memory, per-browser registry seeded with demo
// records. That store is gone: the backend is the source of truth, ownership is
// derived server-side from the authenticated user, and what a viewer may see is
// decided by the authorized response — never by a client-side filter.
//
// The mapping to `RegistryContact` keeps the existing Clients/Wizard screens
// working unchanged. The responsible employee's display name comes from the
// backend (`responsibleEmployeeName`, derived from the related `User.name`);
// linked properties come from the backend, already filtered by property
// visibility.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Role, type AuthUser } from '@arkan/shared';
import { listContacts } from './api/contacts-api';
import type { ContactDto, ContactTypeApi, DealType } from './api/property-types';

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
  /** Responsible employee's display name from the backend; '' when unassigned. */
  ownerName: string;
  /** Linked property ids (`Property.contactId`) the viewer is authorized to see. */
  propertyIds: string[];
  /** References of the same linked properties, in backend order. */
  propertyCodes: string[];
  /**
   * Transaction type (`DealType`) of each linked property, index-parallel with
   * `propertyIds`/`propertyCodes`. Every `Property` row carries one, so these
   * grouped counts are always complete — never guessed client-side.
   */
  dealTypes: DealType[];
  notes: string;
  createdAt: string;
}

/** Arabic pill label per owner transaction type. */
export const OWNER_TYPE_LABEL: Record<DealType, string> = {
  SALE: 'بايع',
  RENT: 'مؤجّر',
  EXCHANGE: 'مبدّل',
};

/** One compact pill on an owner card: the Arabic label plus its real count. */
export interface OwnerTypePill {
  type: DealType;
  label: string;
  count: number;
}

/**
 * Groups the linked properties' transaction types into one pill per type.
 * Counts are of DISTINCT properties: `Property.contactId` links each property
 * row once, and the backend already dedupes by property id, so each row counts
 * exactly once. A type with zero properties never produces a pill, and when all
 * linked properties are classified (always — `listingType` is required) the sum
 * of the counts equals the card's linked-property count.
 */
export function ownerTypePills(
  properties: readonly { id: string; listingType: DealType }[],
): OwnerTypePill[] {
  const seen = new Set<string>();
  const counts = new Map<DealType, number>();
  for (const property of properties) {
    if (!property.id) continue; // never count an unattached row twice
    if (seen.has(property.id)) continue;
    seen.add(property.id);
    counts.set(property.listingType, (counts.get(property.listingType) ?? 0) + 1);
  }
  // Stable display order: sale, rent, exchange; zero types stay hidden.
  const order: DealType[] = ['SALE', 'RENT', 'EXCHANGE'];
  return order
    .filter((type) => (counts.get(type) ?? 0) > 0)
    .map((type) => ({
      type,
      label: OWNER_TYPE_LABEL[type],
      count: counts.get(type) ?? 0,
    }));
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
    ownerName: dto.responsibleEmployeeName ?? '',
    propertyIds: dto.properties.map((property) => property.id),
    propertyCodes: dto.properties.map((property) => property.reference),
    dealTypes: dto.properties.map((property) => property.listingType),
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
