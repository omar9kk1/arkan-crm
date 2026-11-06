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

jest.setTimeout(60000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('Properties API (workflow, visibility, privacy)', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const employeePayload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: String(900000 + ++seq),
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }, { type: 'FIRST' }],
    newContact: { type: 'BROKER', name: 'Broker A', phone: '66661111' },
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@test.local',
      name: 'Manager',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@test.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@test.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects unauthenticated access to every property endpoint', async () => {
    expect((await api().get('/properties')).status).toBe(401);
    expect(
      (await api().get('/properties/00000000-0000-0000-0000-000000000000'))
        .status,
    ).toBe(401);
  });

  it('makes a MANAGER property AVAILABLE immediately with no approval record', async () => {
    const response = await postProperty(
      ctx.app,
      managerToken,
      employeePayload({
        newContact: { type: 'OWNER', name: 'Manager Owner', phone: '22220000' },
      }),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('AVAILABLE');
    // Creator role is server-derived, so the card can label a manager-created
    // row «مدير» without exposing the manager's personal name.
    expect(response.body.data.responsibleRole).toBe('MANAGER');
    expect(response.body.data.responsibleName).toBe('Manager');
    const approvals = await ctx.prisma.propertyApprovalRequest.count({
      where: { propertyId: response.body.data.id },
    });
    expect(approvals).toBe(0);
    expect(managerId).toBeTruthy();
  });

  it('makes an EMPLOYEE property PENDING and creates the initial approval record', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PENDING');
    // The employee creator's real User name — never the owner/broker contact.
    expect(response.body.data.responsibleRole).toBe('EMPLOYEE');
    expect(response.body.data.responsibleName).toBe('Employee A');
    const approvals = await ctx.prisma.propertyApprovalRequest.findMany({
      where: { propertyId: response.body.data.id },
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.status).toBe('PENDING');
    expect(approvals[0]?.requestedById).toBe(employeeAId);
  });

  it('generates a unique reference, a title and a legacy area from the district', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ district: 'الجابرية' }),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.reference).toMatch(/^P-\d{6}$/);
    expect(response.body.data.title).toContain('الجابرية');
    const row = await ctx.prisma.property.findUnique({
      where: { id: response.body.data.id },
      select: { area: true, district: true },
    });
    expect(row?.area).toBe('الجابرية');
    expect(row?.district).toBe('الجابرية');
  });

  it('rejects requestedProperty on a non-EXCHANGE listing', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ requestedProperty: { district: 'السالمية' } }),
      image,
    );
    expect(response.status).toBe(400);
  });

  it('rejects a public description that embeds a contact phone number', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ description: 'للتواصل واتساب 66667777 فقط' }),
      image,
    );
    expect(response.status).toBe(400);
  });

  it('forbids an employee from approving or rejecting', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    expect(
      (await api().post(`/properties/${id}/approve`).set(auth(employeeAToken)).send({})).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(`/properties/${id}/reject`)
          .set(auth(employeeAToken))
          .send({ reason: 'no' })
      ).status,
    ).toBe(403);
  });

  it('lets a manager approve PENDING -> AVAILABLE and increments version', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    expect(created.body.data.version).toBe(1);
    const approved = await api()
      .post(`/properties/${id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');
    expect(approved.body.data.version).toBe(2);
    const approval = await ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: id },
    });
    expect(approval?.status).toBe('APPROVED');
    expect(approval?.reviewedById).toBe(managerId);
  });

  it('lets a manager reject with a mandatory reason and stores it', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    const emptyReason = await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: '   ' });
    expect(emptyReason.status).toBe(400);
    const rejected = await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'الصورة غير واضحة' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    const approval = await ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: id, status: 'REJECTED' },
    });
    expect(approval?.notes).toBe('الصورة غير واضحة');
  });

  it('hides REJECTED and PENDING properties from other employees and enforces 409 on invalid transitions', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    // Creator sees it; another employee must not.
    expect((await api().get(`/properties/${id}`).set(auth(employeeAToken))).status).toBe(200);
    expect((await api().get(`/properties/${id}`).set(auth(employeeBToken))).status).toBe(404);
    // Approving an already-approved property is a conflicting transition.
    expect(
      (await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({})).status,
    ).toBe(200);
    expect(
      (await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({})).status,
    ).toBe(409);
    // Resubmitting a non-REJECTED property is invalid.
    expect(
      (await api().post(`/properties/${id}/resubmit`).set(auth(employeeAToken))).status,
    ).toBe(409);
  });

  it('lets the creator correct and resubmit a rejected property while preserving history', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'المساحة غير صحيحة' });

    // Editing alone must NOT publish the property.
    const patched = await api()
      .patch(`/properties/${id}`)
      .set(auth(employeeAToken))
      .send({ version: 2, sizeSqm: '450.00', description: 'تم تصحيح المساحة' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe('REJECTED');
    expect(patched.body.data.version).toBe(3);

    // A stale version is rejected.
    const stale = await api()
      .patch(`/properties/${id}`)
      .set(auth(employeeAToken))
      .send({ version: 2, sizeSqm: '460.00' });
    expect(stale.status).toBe(409);

    // Non-creator cannot edit.
    const forbidden = await api()
      .patch(`/properties/${id}`)
      .set(auth(employeeBToken))
      .send({ version: 3, sizeSqm: '470.00' });
    expect([403, 404]).toContain(forbidden.status);

    const resubmitted = await api()
      .post(`/properties/${id}/resubmit`)
      .set(auth(employeeAToken));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('PENDING');
    // Rejection history preserved + a new pending request created.
    const requests = await ctx.prisma.propertyApprovalRequest.findMany({
      where: { propertyId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(requests.map((r) => r.status)).toEqual(['REJECTED', 'PENDING']);
  });

  it('never allows an approval and a rejection race to both succeed', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    const [approve, reject] = await Promise.all([
      api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({}),
      api()
        .post(`/properties/${id}/reject`)
        .set(auth(managerToken))
        .send({ reason: 'سبب' }),
    ]);
    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
  });

  it('enforces privacy: another employee sees public data but never the contact', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({
        newContact: { type: 'BROKER', name: 'Private Broker', phone: '69998877' },
      }),
      image,
    );
    const id = created.body.data.id;
    // Creator sees the private contact.
    const own = await api().get(`/properties/${id}`).set(auth(employeeAToken));
    expect(own.body.data.proposedOwner?.phone).toBe('69998877');

    await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

    const other = await api().get(`/properties/${id}`).set(auth(employeeBToken));
    expect(other.status).toBe(200);
    expect(other.body.data.status).toBe('AVAILABLE');
    expect('contact' in other.body.data).toBe(false);
    expect('contactId' in other.body.data).toBe(false);
    expect(JSON.stringify(other.body)).not.toContain('69998877');
    expect(JSON.stringify(other.body)).not.toContain('Private Broker');

    const manager = await api().get(`/properties/${id}`).set(auth(managerToken));
    expect(manager.body.data.contact?.phone).toBe('69998877');
  });

  it('does not leak private contacts through the list endpoint', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({
        newContact: { type: 'OWNER', name: 'List Secret', phone: '68008000' },
      }),
      image,
    );
    await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({});
    const list = await api().get('/properties').set(auth(employeeBToken));
    expect(list.status).toBe(200);
    for (const item of list.body.data.items)
      expect('contact' in item).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('68008000');
    expect(JSON.stringify(list.body)).not.toContain('List Secret');
  });

  it('returns a non-disclosing 404 for a guessed property id', async () => {
    const response = await api()
      .get('/properties/11111111-2222-3333-4444-555555555555')
      .set(auth(employeeBToken));
    expect(response.status).toBe(404);
  });

  it('does not crash on a legacy property that has no contact or image', async () => {
    const legacy = await ctx.prisma.property.create({
      data: {
        reference: 'LEGACY-NO-CONTACT',
        title: 'عقار قديم',
        area: 'موقع غير محدد',
        currency: 'KWD',
        status: 'AVAILABLE',
        listingType: 'SALE',
        createdByUserId: employeeAId,
      },
    });
    const read = await api().get(`/properties/${legacy.id}`).set(auth(employeeBToken));
    expect(read.status).toBe(200);
    expect(read.body.data.primaryImageUrl).toBeNull();
    expect('contact' in read.body.data).toBe(false);
    const image404 = await api()
      .get(`/properties/${legacy.id}/image`)
      .set(auth(employeeBToken));
    expect(image404.status).toBe(404);
    expect(employeeBId).toBeTruthy();
  });

  describe('free-text search (`q`) — the wizard property link', () => {
    /** Seed a Property row directly, with a controlled reference code. */
    const seed = async (
      reference: string,
      overrides: Partial<{
        status: 'AVAILABLE' | 'PENDING';
        listingType: 'SALE' | 'RENT' | 'EXCHANGE';
        createdByUserId: string | null;
        district: string | null;
        governorate: string | null;
        title: string;
        askingPrice: string;
      }> = {},
    ) =>
      ctx.prisma.property.create({
        data: {
          reference,
          title: overrides.title ?? `عقار بحث ${reference}`,
          area: overrides.district ?? overrides.governorate ?? 'غير محدد',
          district: overrides.district ?? null,
          governorate: overrides.governorate ?? null,
          currency: 'KWD',
          status: overrides.status ?? 'AVAILABLE',
          listingType: overrides.listingType ?? 'SALE',
          askingPrice: overrides.askingPrice ?? '150000.00',
          createdByUserId:
            overrides.createdByUserId === undefined
              ? employeeAId
              : overrides.createdByUserId,
        },
      });

    it('finds a property by its FULL code, case-insensitively', async () => {
      const row = await seed('SEARCH-CODE-AK1', {
        createdByUserId: managerId,
      });
      for (const token of [managerToken, employeeAToken]) {
        const response = await api()
          .get('/properties?q=SEARCH-CODE-AK1')
          .set(auth(token));
        expect(response.status).toBe(200);
        expect(response.body.data.items).toHaveLength(1);
        expect(response.body.data.items[0].id).toBe(row.id);
      }
      // Same row found even typed in lowercase.
      const lowercase = await api()
        .get('/properties?q=search-code-ak1')
        .set(auth(managerToken));
      expect(lowercase.body.data.items.map((i: { id: string }) => i.id)).toEqual(
        [row.id],
      );
    });

    it('matches public listing fields: district, title and governorate', async () => {
      await seed('SEARCH-AREA-1', { district: 'سالمية البحث' });
      await seed('SEARCH-AREA-2', { title: 'شقة بسالمية البحث للإيجار' });
      await seed('SEARCH-OTHER', { district: 'الجهراء' });

      const byDistrict = await api()
        .get('/properties?q=البحث')
        .set(auth(employeeAToken));
      const references = byDistrict.body.data.items.map(
        (i: { reference: string }) => i.reference,
      );
      expect(references).toContain('SEARCH-AREA-1');
      expect(references).toContain('SEARCH-AREA-2');
      expect(references).not.toContain('SEARCH-OTHER');
    });

    it('never returns a row the viewer may not see — search obeys RBAC', async () => {
      // Another employee's PENDING row: invisible to employee A, visible to
      // its creator and to the manager.
      const hiddenFromA = await seed('SEARCH-HIDDEN-1', {
        status: 'PENDING',
        createdByUserId: employeeBId,
      });
      const asA = await api()
        .get('/properties?q=SEARCH-HIDDEN-1')
        .set(auth(employeeAToken));
      expect(asA.status).toBe(200);
      expect(asA.body.data.items).toHaveLength(0);
      const asB = await api()
        .get('/properties?q=SEARCH-HIDDEN-1')
        .set(auth(employeeBToken));
      expect(asB.body.data.items.map((i: { id: string }) => i.id)).toEqual([
        hiddenFromA.id,
      ]);
      const asManager = await api()
        .get('/properties?q=SEARCH-HIDDEN-1')
        .set(auth(managerToken));
      expect(asManager.body.data.items.map((i: { id: string }) => i.id)).toEqual(
        [hiddenFromA.id],
      );
    });

    it('returns the public projection in search rows — no private contact', async () => {
      await seed('SEARCH-PUBLIC-1');
      const response = await api()
        .get('/properties?q=SEARCH-PUBLIC-1')
        .set(auth(employeeBToken));
      expect(response.status).toBe(200);
      for (const item of response.body.data.items as Record<string, unknown>[]) {
        expect('contact' in item).toBe(false);
        expect(item.reference).toBe('SEARCH-PUBLIC-1');
      }
    });

    it('combines `q` with the status filter and bounded limit', async () => {
      await seed('SEARCH-LIMIT-1', { status: 'AVAILABLE' });
      await seed('SEARCH-LIMIT-2', { status: 'PENDING' });
      const onlyAvailable = await api()
        .get('/properties?q=SEARCH-LIMIT&status=AVAILABLE')
        .set(auth(employeeAToken));
      expect(
        onlyAvailable.body.data.items.map((i: { reference: string }) => i.reference),
      ).toEqual(['SEARCH-LIMIT-1']);
      const bounded = await api()
        .get('/properties?q=SEARCH-LIMIT&limit=1')
        .set(auth(employeeAToken));
      expect(bounded.body.data.items).toHaveLength(1);
      expect(bounded.body.data.items[0]).toEqual(
        expect.objectContaining({ id: expect.any(String) }),
      );
    });

    it('whitespace-only `q` is ignored; empty or over-long `q` is rejected', async () => {
      // Whitespace-only survives the DTO (length ≥ 1) and the service trims it
      // to nothing, so the query behaves exactly like no filter at all.
      expect(
        (await api().get('/properties?q=%20%20').set(auth(managerToken))).status,
      ).toBe(200);
      // An EMPTY query value fails validation rather than matching everything.
      expect((await api().get('/properties?q=').set(auth(managerToken))).status).toBe(
        400,
      );
      expect((await api().get(`/properties?q=${'ك'.repeat(81)}`).set(auth(managerToken))).status).toBe(
        400,
      );
      const normal = await api().get('/properties').set(auth(managerToken));
      expect(normal.status).toBe(200);
    });
  });

  describe('creator editing an approved property', () => {
    /** Create → approve, and return the approved row with one APPROVED round. */
    const approvedRow = async () => {
      const created = await postProperty(
        ctx.app,
        employeeAToken,
        employeePayload(),
        image,
      );
      const id = created.body.data.id as string;
      await api()
        .post(`/properties/${id}/approve`)
        .set(auth(managerToken))
        .send({});
      const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('AVAILABLE');
      return row;
    };

    it('lets the creator edit an AVAILABLE row: PENDING + a new approval round', async () => {
      const row = await approvedRow();
      const before = await ctx.prisma.propertyApprovalRequest.findMany({
        where: { propertyId: row.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(before.map((r) => r.status)).toEqual(['APPROVED']);

      const patched = await api()
        .patch(`/properties/${row.id}`)
        .set(auth(employeeAToken))
        .send({ version: row.version, sizeSqm: '455.00' });
      expect(patched.status).toBe(200);
      // The edit sends it back through review.
      expect(patched.body.data.status).toBe('PENDING');
      expect(patched.body.data.version).toBe(row.version + 1);

      // History preserved + exactly one new open round (no duplicates).
      const after = await ctx.prisma.propertyApprovalRequest.findMany({
        where: { propertyId: row.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(after.map((r) => r.status)).toEqual(['APPROVED', 'PENDING']);
      expect(after.filter((r) => r.status === 'PENDING')).toHaveLength(1);
      expect(after[1]?.requestedById).toBe(employeeAId);
    });

    it('denies another employee editing the approved row', async () => {
      const row = await approvedRow();
      const denied = await api()
        .patch(`/properties/${row.id}`)
        .set(auth(employeeBToken))
        .send({ version: row.version, sizeSqm: '500.00' });
      expect([403, 404]).toContain(denied.status);
      // Nothing changed and no review round was created.
      const still = await ctx.prisma.property.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(still.status).toBe('AVAILABLE');
      expect(still.version).toBe(row.version);
      expect(
        await ctx.prisma.propertyApprovalRequest.count({
          where: { propertyId: row.id, status: 'PENDING' },
        }),
      ).toBe(0);
    });

    it('notifies the managers about the reopened review', async () => {
      const row = await approvedRow();
      await ctx.prisma.notification.deleteMany({});
      const patched = await api()
        .patch(`/properties/${row.id}`)
        .set(auth(employeeAToken))
        .send({ version: row.version, district: 'الصباحية' });
      expect(patched.status).toBe(200);
      expect(patched.body.data.status).toBe('PENDING');
      expect(
        await ctx.prisma.notification.count({
          where: { userId: managerId, type: 'PROPERTY_RESUBMITTED' },
        }),
      ).toBe(1);
    });

    it('restores AVAILABLE when the manager approves the re-edited row', async () => {
      const row = await approvedRow();
      const patched = await api()
        .patch(`/properties/${row.id}`)
        .set(auth(employeeAToken))
        .send({ version: row.version, sizeSqm: '470.00' });
      const reopened = await api()
        .post(`/properties/${row.id}/approve`)
        .set(auth(managerToken))
        .send({ version: patched.body.data.version });
      expect(reopened.status).toBe(200);
      expect(reopened.body.data.status).toBe('AVAILABLE');
      const rounds = await ctx.prisma.propertyApprovalRequest.findMany({
        where: { propertyId: row.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rounds.map((r) => r.status)).toEqual(['APPROVED', 'APPROVED']);
    });

    it('creates no duplicate contact when the linked contact is untouched', async () => {
      const created = await postProperty(
        ctx.app,
        employeeAToken,
        employeePayload({
          newContact: { type: 'OWNER', name: 'Reuse Owner', phone: '61234567' },
        }),
        image,
      );
      const id = created.body.data.id as string;
      await api()
        .post(`/properties/${id}/approve`)
        .set(auth(managerToken))
        .send({});
      const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id } });
      const contactsBefore = await ctx.prisma.contact.count();
      expect(row.contactId).toBeTruthy();

      // The wizard re-sends the SAME linked contactId on an unchanged edit.
      const patched = await api()
        .patch(`/properties/${id}`)
        .set(auth(employeeAToken))
        .send({
          version: row.version,
          contactId: row.contactId,
          sizeSqm: '460.00',
        });
      expect(patched.status).toBe(200);
      const after = await ctx.prisma.property.findUniqueOrThrow({
        where: { id },
      });
      expect(after.contactId).toBe(row.contactId);
      expect(await ctx.prisma.contact.count()).toBe(contactsBefore);
    });

    it('rejects a second concurrent edit of the same approved row', async () => {
      const row = await approvedRow();
      const results = await Promise.all([
        api()
          .patch(`/properties/${row.id}`)
          .set(auth(employeeAToken))
          .send({ version: row.version, sizeSqm: '481.00' }),
        api()
          .patch(`/properties/${row.id}`)
          .set(auth(employeeAToken))
          .send({ version: row.version, sizeSqm: '482.00' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      // Exactly one open round: the loser created nothing.
      expect(
        await ctx.prisma.propertyApprovalRequest.count({
          where: { propertyId: row.id, status: 'PENDING' },
        }),
      ).toBe(1);
    });
  });
});
