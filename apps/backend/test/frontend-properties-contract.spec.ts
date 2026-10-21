import type { Server } from 'node:http';
import { ApiError } from '../../frontend/lib/api-client';
import { signIn, signOut } from '../../frontend/features/auth/session';
import {
  approveProperty,
  createProperty,
  getProperty,
  getPropertyImage,
  listProperties,
  rejectProperty,
  requestChangesProperty,
  resubmitProperty,
  updateProperty,
} from '../../frontend/lib/api/properties-api';
import {
  createContact,
  getContact,
  listContacts,
  updateContact,
} from '../../frontend/lib/api/contacts-api';
import {
  toCreatePropertyPayload,
  toUpdatePropertyPayload,
  type PropertyFormInput,
} from '../../frontend/lib/property-adapter';
import type { PrivatePropertyDto } from '../../frontend/lib/api/property-types';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  pngBytes,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';
import request from 'supertest';
import { Role } from '@arkan/shared';

jest.setTimeout(120000);

/**
 * Phase 4A contract tests.
 *
 * These drive the REAL frontend API layer (`lib/api/*`, `features/auth/session`)
 * against a REAL Nest application and the ISOLATED test database — so the
 * multipart `FormData` shape, the `{ data }` envelope unwrapping, the bearer
 * handling, the 401 refresh path and the Arabic error mapping are all exercised
 * as the browser would exercise them. Only `sessionStorage`/`localStorage` are
 * polyfilled, because Jest runs in Node.
 */

/** Minimal Web Storage good enough for `session.ts`. */
function installStorage() {
  const make = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: make(),
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: make(),
  });
}

const PASSWORD = 'ChangeMe123!';

function form(overrides: Partial<PropertyFormInput> = {}): PropertyFormInput {
  return {
    entryMethod: 'MANUAL',
    operation: 'بيع',
    governorate: 'الجهراء',
    district: 'المطلاع',
    block: '2',
    plotNumber: '15',
    area: '400',
    landArea: '',
    unitArea: '',
    floorCount: 1,
    floors: [{ label: 'الأرضي', customLabel: '', details: 'صالة ومطبخ' }],
    price: '250000',
    negotiable: 'قابل للتفاوض',
    requestedProperty: {
      governorate: '',
      district: '',
      block: '',
      plotNumber: '',
      area: '',
      floorRequirements: '',
      notes: '',
      budget: { min: '', max: '' },
    },
    contactType: 'OWNER',
    ownerMode: 'NEW',
    brokerMode: 'NEW',
    ownerId: '',
    brokerId: '',
    brokerName: '',
    brokerPhone: '',
    ownerName: 'أبو فهد',
    contactPhone: '66661122',
    ...overrides,
  };
}

function imageFile(): File {
  return new File([new Uint8Array(pngBytes())], 'property.png', {
    type: 'image/png',
  });
}

describeWithDatabase('Phase 4A frontend API contract', () => {
  let context: TestContext;
  let server: Server;
  let baseUrl: string;
  let firstEmployeeToken: string;
  let secondEmployeeToken: string;

  beforeAll(async () => {
    installStorage();
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1';
    context = await createTestApp();
    await new Promise<void>((resolve) => {
      server = context.app.getHttpServer().listen(0, '127.0.0.1', () =>
        resolve(),
      );
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('test server did not expose a port');
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.NEXT_PUBLIC_API_URL = baseUrl;

    await resetDatabase(context.prisma);
    await createUser(context.prisma, {
      email: 'manager@arkan.test',
      name: 'مدير النظام',
      role: Role.MANAGER,
    });
    await createUser(context.prisma, {
      email: 'emp1@arkan.test',
      name: 'أحمد محمد',
      role: Role.EMPLOYEE,
    });
    await createUser(context.prisma, {
      email: 'emp2@arkan.test',
      name: 'سارة أحمد',
      role: Role.EMPLOYEE,
    });
    firstEmployeeToken = await login(context.app, 'emp1@arkan.test');
    secondEmployeeToken = await login(context.app, 'emp2@arkan.test');
  });

  afterAll(async () => {
    await signOut().catch(() => undefined);
    // Node's global fetch keeps sockets alive, so `close()` would wait forever
    // for the keep-alive connections to drain.
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await context.close();
  });

  beforeEach(() => {
    // Every test re-authenticates (some switch roles several times), so this
    // file alone performs far more than 10 POST /auth/login calls per minute
    // from the same IP — exactly what the production limiter is meant to do.
    // Reset the shared in-memory counters per test so the suite is never
    // throttled; the limiter itself is covered by auth-rate-limit.spec.ts.
    resetRateLimiting(context.app);
  });

  it('signs in through the frontend session stack and stores a token', async () => {
    const session = await signIn({
      email: 'emp1@arkan.test',
      password: PASSWORD,
    });
    expect(session.user.role).toBe('EMPLOYEE');
    expect(session.accessToken).toBeTruthy();
  });

  it('rejects an unauthenticated request with the Arabic 401 message', async () => {
    await signOut();
    await expect(listProperties()).rejects.toMatchObject({
      status: 401,
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو انتهت الجلسة.',
    });
    // Re-establish a session for the remaining tests.
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
  });

  it('creates a contact through the API and lists it back', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createContact({
      type: 'OWNER',
      name: 'أبو فهد',
      phone: '66661122',
    });
    expect(created.type).toBe('OWNER');
    expect(created.responsibleUserId).toBeTruthy();

    const page = await listContacts({ limit: 100 });
    expect(page.items.map((item) => item.id)).toContain(created.id);

    const fetched = await getContact(created.id);
    expect(fetched.phone).toBe('66661122');

    const updated = await updateContact(created.id, { notes: 'مالك مباشر' });
    expect(updated.notes).toBe('مالك مباشر');
  });

  it('keeps OWNER and BROKER distinct in the list', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const broker = await createContact({
      type: 'BROKER',
      name: 'وسيط الكويت',
      phone: '99998888',
    });
    const owners = await listContacts({ type: 'OWNER', limit: 100 });
    const brokers = await listContacts({ type: 'BROKER', limit: 100 });
    expect(owners.items.every((item) => item.type === 'OWNER')).toBe(true);
    expect(brokers.items.map((item) => item.id)).toContain(broker.id);
    expect(owners.items.map((item) => item.id)).not.toContain(broker.id);
  });

  it('creates a property with exactly one image via multipart FormData', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const payload = toCreatePropertyPayload(form());
    const created = await createProperty(payload, imageFile());

    expect(created.status).toBe('PENDING');
    // The permanent sequential code: A-000001, A-000002, …
    expect(created.reference).toMatch(/^A-\d{6}$/);
    expect(created.version).toBe(1);
    expect(created.primaryImageUrl).toBeTruthy();
    // Public description: the private phone must never be persisted there.
    expect(created.description ?? '').not.toContain('66661122');
    expect(created.sizeSqm).toBe('400');
    expect(created.askingPrice).toBe('250000');
    expect(created.floors).toEqual([
      expect.objectContaining({ type: 'GROUND', details: 'صالة ومطبخ' }),
    ]);
  });

  it('rejects a payload that carries both contactId and newContact', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const contact = await createContact({
      type: 'OWNER',
      name: 'مالك مزدوج',
      phone: '60000000',
    });
    const payload = {
      ...toCreatePropertyPayload(form()),
      contactId: contact.id,
      newContact: { type: 'OWNER' as const, name: 'أبو فهد', phone: '66661122' },
    };
    await expect(createProperty(payload, imageFile())).rejects.toMatchObject({
      status: 400,
    });
  });

  it('walks the full employee → manager → employee review cycle', async () => {
    // Employee creates.
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'الصباحية', block: '7' })),
      imageFile(),
    );

    // The creator sees their own PENDING row with the private contact.
    const own = (await getProperty(created.id)) as PrivatePropertyDto;
    expect(own.status).toBe('PENDING');
    expect(own.contact?.phone).toBe('66661122');

    const ownList = await listProperties({ limit: 100 });
    expect(ownList.items.map((item) => item.id)).toContain(created.id);

    // A different employee must not see the PENDING row at all.
    await signIn({ email: 'emp2@arkan.test', password: PASSWORD });
    const otherList = await listProperties({ limit: 100 });
    expect(otherList.items.map((item) => item.id)).not.toContain(created.id);
    await expect(getProperty(created.id)).rejects.toMatchObject({ status: 404 });

    // The manager sees the pending queue with the authorized private contact.
    await signIn({ email: 'manager@arkan.test', password: PASSWORD });
    const pending = await listProperties({ status: 'PENDING', limit: 100 });
    expect(pending.items.map((item) => item.id)).toContain(created.id);
    const managed = (await getProperty(created.id)) as PrivatePropertyDto;
    expect(managed.contact?.phone).toBe('66661122');
    expect(managed.contact?.name).toBe('أبو فهد');

    // Approve with the row version.
    const approved = await approveProperty(created.id, managed.version);
    expect(approved.status).toBe('AVAILABLE');

    // Approving again with the now-stale version must fail with the contract 409.
    await expect(
      approveProperty(created.id, managed.version),
    ).rejects.toMatchObject({
      status: 409,
      message: 'تغيّر هذا العقار أو تمت مراجعته بالفعل. حدّث الصفحة لعرض أحدث حالته.',
    });

    // The creator keeps access to the private contact after approval.
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const stillOwn = (await getProperty(created.id)) as PrivatePropertyDto;
    expect(stillOwn.status).toBe('AVAILABLE');
    expect(stillOwn.contact?.phone).toBe('66661122');

    // Another employee now sees the AVAILABLE row WITHOUT the private contact.
    await signIn({ email: 'emp2@arkan.test', password: PASSWORD });
    const visible = await getProperty(created.id);
    expect(visible.status).toBe('AVAILABLE');
    expect(
      (visible as PrivatePropertyDto).contact ?? null,
    ).toBeNull();
    expect(visible.responsibleName).toBe('أحمد محمد');
    // The public projection still carries the creator role (not contact data),
    // so the card can render the responsible pill for any authorized viewer.
    expect(visible.responsibleRole).toBe('EMPLOYEE');
  });

  it('rejects with a mandatory reason and lets the creator correct then resubmit', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'الفنطاس', block: '3' })),
      imageFile(),
    );

    await signIn({ email: 'manager@arkan.test', password: PASSWORD });
    const beforeReject = await getProperty(created.id);
    await expect(
      rejectProperty(created.id, '   ', beforeReject.version),
    ).rejects.toMatchObject({ status: 400 });
    const rejected = await rejectProperty(
      created.id,
      'يرجى توضيح المساحة وإرفاق صورة أوضح.',
      beforeReject.version,
    );
    expect(rejected.status).toBe('REJECTED');

    // The employee sees the rejection reason and can correct the row.
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const rejectedForEmployee = (await getProperty(created.id)) as PrivatePropertyDto;
    expect(rejectedForEmployee.status).toBe('REJECTED');
    expect(rejectedForEmployee.reviewNotes).toContain('يرجى توضيح المساحة');

    const corrected = await updateProperty(
      created.id,
      toUpdatePropertyPayload(form({ district: 'الفنطاس', area: '450' }), rejectedForEmployee.version),
    );
    // Correcting alone must NOT publish the listing.
    expect(corrected.status).toBe('REJECTED');
    expect(corrected.version).toBe(rejectedForEmployee.version + 1);

    const resubmitted = await resubmitProperty(created.id);
    expect(resubmitted.status).toBe('PENDING');
  });

  it('drives request-changes → correct → resubmit → approve through the frontend layer', async () => {
    // Employee creates a fresh pending row.
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'الوفرة', block: '11' })),
      imageFile(),
    );
    expect(created.status).toBe('PENDING');

    // Manager asks for changes through the real frontend API function.
    await signIn({ email: 'manager@arkan.test', password: PASSWORD });
    const beforeChanges = await getProperty(created.id);
    const requested = (await requestChangesProperty(
      created.id,
      'يرجى مراجعة السعر.',
      beforeChanges.version,
    )) as PrivatePropertyDto;
    // Not a rejection: the row stays PENDING and the review is CHANGES_REQUESTED.
    expect(requested.status).toBe('PENDING');
    expect(requested.reviewStatus).toBe('CHANGES_REQUESTED');
    expect(requested.reviewNotes).toContain('يرجى مراجعة السعر');

    // The manager cannot approve the still-PENDING row before resubmission.
    await expect(
      approveProperty(created.id, requested.version),
    ).rejects.toMatchObject({ status: 409 });

    // The creator sees the instructions, corrects and resubmits.
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const forEmployee = (await getProperty(created.id)) as PrivatePropertyDto;
    expect(forEmployee.reviewStatus).toBe('CHANGES_REQUESTED');
    expect(forEmployee.reviewNotes).toContain('يرجى مراجعة السعر');
    const corrected = await updateProperty(
      created.id,
      toUpdatePropertyPayload(
        form({ district: 'الوفرة', area: '460' }),
        forEmployee.version,
      ),
    );
    // Correcting alone keeps it awaiting correction, not review.
    expect(corrected.status).toBe('PENDING');
    const resubmitted = (await resubmitProperty(
      created.id,
    )) as PrivatePropertyDto;
    expect(resubmitted.status).toBe('PENDING');
    expect(resubmitted.reviewStatus).toBe('PENDING');
    expect(resubmitted.reviewNotes).toBeNull();

    // Manager approves after the resubmission.
    await signIn({ email: 'manager@arkan.test', password: PASSWORD });
    const approved = await approveProperty(created.id, resubmitted.version);
    expect(approved.status).toBe('AVAILABLE');

    // My Properties: the creator now sees the approved row with isMine = true…
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const mine = await listProperties({ limit: 100 });
    expect(mine.items.find((item) => item.id === created.id)?.isMine).toBe(true);
    // …while another employee sees the same AVAILABLE row with isMine = false.
    await signIn({ email: 'emp2@arkan.test', password: PASSWORD });
    const theirs = await listProperties({ limit: 100 });
    expect(theirs.items.find((item) => item.id === created.id)?.isMine).toBe(
      false,
    );
  });

  it('refuses a stale PATCH version with the contract 409 message', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'القرين', block: '4' })),
      imageFile(),
    );
    const current = await getProperty(created.id);
    await expect(
      updateProperty(
        created.id,
        toUpdatePropertyPayload(form({ district: 'القرين' }), current.version + 99),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'تغيّر هذا العقار أو تمت مراجعته بالفعل. حدّث الصفحة لعرض أحدث حالته.',
    });
  });

  it('refuses another employee editing or resubmitting a property', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'العقيلة', block: '5' })),
      imageFile(),
    );

    await signIn({ email: 'emp2@arkan.test', password: PASSWORD });
    // "Only the property creator can resubmit this property" → Forbidden.
    await expect(resubmitProperty(created.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      updateProperty(
        created.id,
        toUpdatePropertyPayload(form({ district: 'العقيلة' }), 1),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('reads the property image as an authenticated blob only', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'الرقة', block: '6' })),
      imageFile(),
    );
    const blob = await getPropertyImage(created.id);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type.startsWith('image/')).toBe(true);

    // Unauthenticated access to the same bytes is refused.
    const noAuth = await request(context.app.getHttpServer()).get(
      `/properties/${created.id}/image`,
    );
    expect(noAuth.status).toBe(401);
  });

  it('surfaces the mapped backend validation error for a bad decimal', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const payload = {
      ...toCreatePropertyPayload(form()),
      askingPrice: '10.999',
    };
    const error = await createProperty(payload, imageFile()).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toContain('كسر عشري');
  });

  it('refuses a manager-only decision for an employee token', async () => {
    await signIn({ email: 'emp1@arkan.test', password: PASSWORD });
    const created = await createProperty(
      toCreatePropertyPayload(form({ district: 'الجهراء', block: '8' })),
      imageFile(),
    );
    const current = await getProperty(created.id);
    await expect(
      approveProperty(created.id, current.version),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('leaves the raw backend contract intact (envelope + auth header)', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/properties?limit=1')
      .set(auth(firstEmployeeToken));
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data.items');
    expect(Array.isArray(response.body.data.items)).toBe(true);

    const second = await request(context.app.getHttpServer())
      .get('/properties?limit=1')
      .set(auth(secondEmployeeToken));
    expect(second.status).toBe(200);
  });
});
