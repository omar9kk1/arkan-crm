import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  pngBytes,
  postProperty,
  resetDatabase,
  type TestContext,
} from './support/test-app';
import {
  formatPropertyCode,
  formatSubmissionCode,
} from '../src/properties/property-reference';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

/**
 * P/A numbering:
 *   - employee submission -> P-000001, P-000002, ...
 *   - Manager approval    -> A-000001, A-000002, ... (never while pending)
 *   - rejection/409       -> consume no A
 */
describeWithDatabase('P/A property numbering', () => {
  let ctx: TestContext;
  let managerToken: string;
  let ownerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let seq = 0;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      listingType: 'SALE',
      governorate: 'الجهراء',
      district: 'مدينة المطلاع',
      block: '8',
      plotNumber: String(920000 + seq),
      sizeSqm: '400.00',
      askingPrice: '250000.00',
      negotiable: true,
      description: 'بيت مستقل',
      floors: [{ type: 'GROUND', details: 'مجلس' }],
      newContact: { type: 'OWNER', name: 'Owner Codes', phone: '61110000' },
      ...overrides,
    };
  };

  const createProperty = async (
    token = employeeAToken,
    overrides: Record<string, unknown> = {},
  ) => {
    const response = await postProperty(
      ctx.app,
      token,
      payload(overrides),
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as {
      id: string;
      reference: string;
      submissionReference: string;
      approvedReference: string | null;
      version: number;
    };
  };

  const sequenceValue = async (id: number) => {
    const row = await ctx.prisma.propertyCodeSequence.findUnique({
      where: { id },
    });
    return row?.value ?? 0n;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@pa.local',
      name: 'Manager PA',
      role: Role.MANAGER,
    });
    const owner = await createUser(ctx.prisma, {
      email: 'owner@pa.local',
      name: 'Owner PA',
      role: Role.OWNER,
    });
    const a = await createUser(ctx.prisma, {
      email: 'employee-a@pa.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const b = await createUser(ctx.prisma, {
      email: 'employee-b@pa.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    ownerToken = await login(ctx.app, owner.email);
    employeeAToken = await login(ctx.app, a.email);
    employeeBToken = await login(ctx.app, b.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('formats P and A codes independently', () => {
    expect(formatSubmissionCode(1)).toBe('P-000001');
    expect(formatPropertyCode(1)).toBe('A-000001');
    expect(formatSubmissionCode(123)).toBe('P-000123');
  });

  it('gives every pending submission a sequential P code and no A code', async () => {
    const first = await createProperty();
    const second = await createProperty();
    expect(first.reference).toMatch(/^P-\d{6}$/);
    expect(second.reference).toMatch(/^P-\d{6}$/);
    expect(first.submissionReference).toBe(first.reference);
    expect(first.approvedReference).toBeNull();
    const firstNumber = Number(first.reference.slice(2));
    const secondNumber = Number(second.reference.slice(2));
    expect(secondNumber).toBe(firstNumber + 1);
    expect(await sequenceValue(1)).toBe(0n);
  });

  it('allocates the next A code only on approval and keeps the P code', async () => {
    const pending = await createProperty();
    expect(pending.reference).toMatch(/^P-\d{6}$/);
    const beforeA = await sequenceValue(1);

    const approved = await api()
      .post(`/properties/${pending.id}/approve`)
      .set(auth(managerToken))
      .send({ version: pending.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.reference).toMatch(/^A-\d{6}$/);
    expect(approved.body.data.submissionReference).toBe(pending.reference);
    expect(approved.body.data.approvedReference).toBe(
      approved.body.data.reference,
    );
    expect(await sequenceValue(1)).toBe(beforeA + 1n);

    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(row.reference).toBe(pending.reference);
    expect(row.approvedReference).toBe(approved.body.data.reference);
  });

  it('rejection consumes no A code', async () => {
    const pending = await createProperty();
    const beforeA = await sequenceValue(1);
    const rejected = await api()
      .post(`/properties/${pending.id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'بيانات غير مكتملة' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.reference).toBe(pending.reference);
    expect(await sequenceValue(1)).toBe(beforeA);

    // The next successful approval still gets the next unused A.
    const next = await createProperty();
    const approved = await api()
      .post(`/properties/${next.id}/approve`)
      .set(auth(managerToken))
      .send({ version: next.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.reference).toBe(
      formatPropertyCode(beforeA + 1n),
    );
  });

  it('an exact duplicate 409 consumes neither sequence', async () => {
    const first = await createProperty(employeeAToken, {
      block: '8',
      plotNumber: '930001',
    });
    const pBefore = await sequenceValue(2);
    const aBefore = await sequenceValue(1);
    const duplicate = await postProperty(
      ctx.app,
      employeeBToken,
      payload({ block: '8', plotNumber: '930001' }),
      image,
    );
    expect(duplicate.status).toBe(409);
    expect(await sequenceValue(2)).toBe(pBefore);
    expect(await sequenceValue(1)).toBe(aBefore);
    expect(first.reference).toMatch(/^P-\d{6}$/);
  });

  it('concurrent approvals never duplicate an A code', async () => {
    const pendings = await Promise.all([
      createProperty(),
      createProperty(),
      createProperty(),
      createProperty(),
    ]);
    const results = await Promise.all(
      pendings.map((pending) =>
        api()
          .post(`/properties/${pending.id}/approve`)
          .set(auth(managerToken))
          .send({ version: pending.version }),
      ),
    );
    const codes = results.map((response) => response.body.data.reference);
    expect(results.every((response) => response.status === 200)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((code) => expect(code).toMatch(/^A-\d{6}$/));
    const numbers = codes
      .map((code) => Number(code.slice(2)))
      .sort((a, b) => a - b);
    for (let index = 1; index < numbers.length; index += 1) {
      expect(numbers[index]).toBe((numbers[index - 1] as number) + 1);
    }
  });

  it('a failed (stale) approval does not consume an A code', async () => {
    const pending = await createProperty();
    const beforeA = await sequenceValue(1);
    const stale = await api()
      .post(`/properties/${pending.id}/approve`)
      .set(auth(managerToken))
      .send({ version: pending.version + 99 });
    expect(stale.status).toBe(409);
    expect(await sequenceValue(1)).toBe(beforeA);

    const approved = await api()
      .post(`/properties/${pending.id}/approve`)
      .set(auth(managerToken))
      .send({ version: pending.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.reference).toBe(
      formatPropertyCode(beforeA + 1n),
    );
  });

  it('a potential duplicate keeps the existing review gate before any A code', async () => {
    const original = await createProperty(employeeAToken, {
      block: '8',
      plotNumber: '940001',
    });
    const potential = await createProperty(employeeBToken, {
      // A genuinely uncertain identity: the block conflicts while the plot and
      // owner/attributes match, so this stays POTENTIAL (not CONFIRMED).
      block: '9',
      plotNumber: '940001',
    });
    const beforeA = await sequenceValue(1);

    const bypass = await api()
      .post(`/properties/${potential.id}/approve`)
      .set(auth(managerToken))
      .send({ version: potential.version });
    expect(bypass.status).toBe(400);
    expect(await sequenceValue(1)).toBe(beforeA);

    const approved = await api()
      .post(`/properties/${potential.id}/approve`)
      .set(auth(managerToken))
      .send({ version: potential.version, approveAsDistinct: true });
    expect(approved.status).toBe(200);
    expect(approved.body.data.reference).toBe(
      formatPropertyCode(beforeA + 1n),
    );
    const stillOriginal = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(stillOriginal.reference).toMatch(/^P-\d{6}$/);
    expect(stillOriginal.approvedReference).toBeNull();
  });

  it('trash/restore preserve the assigned code and notifications render it readably', async () => {
    const pending = await createProperty();
    const approved = await api()
      .post(`/properties/${pending.id}/approve`)
      .set(auth(managerToken))
      .send({ version: pending.version });
    expect(approved.status).toBe(200);
    const aCode = approved.body.data.reference as string;

    const trashed = await api()
      .post(`/properties/${pending.id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'اختبار' });
    expect(trashed.status).toBe(200);
    expect(trashed.body.data.reference).toBe(aCode);

    const restored = await api()
      .post(`/properties/${pending.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.data.reference).toBe(aCode);

    // The employee decision notification resolves the active A code.
    const inbox = await api()
      .get('/notifications?limit=50')
      .set(auth(employeeAToken));
    expect(inbox.status).toBe(200);
    const decision = inbox.body.data.items.find(
      (item: { propertyId: string | null }) => item.propertyId === pending.id,
    );
    if (decision) expect(decision.propertyReference).toBe(aCode);
  });

  it('search finds an approved property by its official A code', async () => {
    const pending = await createProperty();
    const approved = await api()
      .post(`/properties/${pending.id}/approve`)
      .set(auth(managerToken))
      .send({ version: pending.version });
    const aCode = approved.body.data.reference as string;
    const search = await api()
      .get(`/properties?q=${encodeURIComponent(aCode)}`)
      .set(auth(managerToken));
    expect(search.status).toBe(200);
    expect(
      search.body.data.items.some(
        (item: { id: string }) => item.id === pending.id,
      ),
    ).toBe(true);
  });
});
