import { randomUUID } from 'node:crypto';
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

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

interface PropertySummary {
  id: string;
  reference: string;
  status: string;
  responsibleName: string | null;
  contact?: unknown;
  contactId?: unknown;
  reviewNotes?: unknown;
  proposedOwner?: unknown;
  duplicateCandidateIds?: unknown;
}

describeWithDatabase('Company-wide approved property visibility', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let sequence = 0;

  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'العاصمة',
    district: `CROSS-${randomUUID().slice(0, 8)}`,
    block: '9',
    plotNumber: String(990000 + ++sequence),
    sizeSqm: '420.00',
    askingPrice: '310000.00',
    negotiable: true,
    description: 'عقار معتمد لاختبار الظهور على مستوى الشركة',
    floors: [{ type: 'GROUND', details: 'دور أرضي' }],
    newContact: {
      type: 'BROKER',
      name: `Private Broker ${sequence}`,
      phone: `664${String(10000 + sequence).padStart(5, '0')}`,
    },
    ...overrides,
  });

  const createAs = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const response = await postProperty(
      ctx.app,
      token,
      payload(overrides),
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as PropertySummary;
  };

  const approve = (token: string, id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(token)).send({});

  const list = async (token: string, query = '') => {
    const response = await api()
      .get(`/properties${query}`)
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data as {
      items: PropertySummary[];
      nextCursor: string | null;
    };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'company.owner@test.local',
      name: 'Company Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'company.manager.a@test.local',
      name: 'Company Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'company.manager.b@test.local',
      name: 'Company Manager B',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'company.employee.a@test.local',
      name: 'Company Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'company.employee.b@test.local',
      name: 'Company Employee B',
      role: Role.EMPLOYEE,
      managerUserId: managerB.id,
    });
    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('keeps a pending row private, then exposes it company-wide after approval with public-only fields', async () => {
    const created = await createAs(employeeAToken);
    const privateBroker = (
      created as unknown as { proposedOwner?: { phone: string } }
    ).proposedOwner;
    expect(privateBroker?.phone).toBeTruthy();

    // Pending: creator/reviewer only.
    expect(
      (await list(managerBToken, `?q=${created.reference}`)).items,
    ).toHaveLength(0);
    expect(
      (await list(employeeBToken, `?q=${created.reference}`)).items,
    ).toHaveLength(0);
    expect(
      (await api().get(`/properties/${created.id}`).set(auth(managerBToken)))
        .status,
    ).toBe(404);
    expect(
      (await api().get(`/properties/${created.id}`).set(auth(employeeBToken)))
        .status,
    ).toBe(404);

    expect(
      (await api().get(`/properties/${created.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${created.id}`).set(auth(employeeAToken)))
        .status,
    ).toBe(200);
    expect(
      (await approve(managerBToken, created.id)).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/properties/${created.id}/approve`)
          .set(auth(employeeBToken))
          .send({})
      ).status,
    ).toBe(403);

    const approved = await approve(managerAToken, created.id);
    expect(approved.status).toBe(200);
    expect((approved.body.data as PropertySummary).status).toBe('AVAILABLE');
    const approvedReference = (approved.body.data as PropertySummary).reference;
    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: created.id },
      select: { contactId: true },
    });
    expect(row.contactId).toBeTruthy();

    for (const token of [managerBToken, employeeBToken]) {
      const listed = await list(token, `?q=${approvedReference}`);
      expect(listed.items.some((item) => item.id === created.id)).toBe(true);

      const detail = await api()
        .get(`/properties/${created.id}`)
        .set(auth(token));
      expect(detail.status).toBe(200);
      const item = detail.body.data as PropertySummary;
      expect(item).toMatchObject({
        id: created.id,
        reference: approvedReference,
        status: 'AVAILABLE',
        responsibleName: 'Company Employee A',
      });
      expect(item.contact).toBeUndefined();
      expect(item.contactId).toBeUndefined();
      expect(item.reviewNotes).toBeUndefined();
      expect(item.proposedOwner).toBeUndefined();
      expect(item.duplicateCandidateIds).toBeUndefined();
      const serialized = JSON.stringify(item);
      expect(serialized).not.toContain('Private Broker');
      expect(serialized).not.toContain('664');

      const imageResponse = await api()
        .get(`/properties/${created.id}/image`)
        .set(auth(token));
      expect(imageResponse.status).toBe(200);

      const contactResponse = await api()
        .get(`/contacts/${row.contactId}`)
        .set(auth(token));
      expect(contactResponse.status).toBe(404);
    }

    const managerADetail = await api()
      .get(`/properties/${created.id}`)
      .set(auth(managerAToken));
    expect(managerADetail.status).toBe(200);
    expect((managerADetail.body.data as { contact?: unknown }).contact).toBeTruthy();

    const ownerDetail = await api()
      .get(`/properties/${created.id}`)
      .set(auth(ownerToken));
    expect(ownerDetail.status).toBe(200);
    expect((ownerDetail.body.data as { contact?: unknown }).contact).toBeTruthy();

    // Company-wide visibility is not edit/approve/delete authority.
    expect(
      (
        await api()
          .patch(`/properties/${created.id}`)
          .set(auth(employeeBToken))
          .send({ version: (approved.body.data as { version: number }).version })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(`/properties/${created.id}`)
          .set(auth(managerBToken))
          .send({ version: (approved.body.data as { version: number }).version })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(`/properties/${created.id}/trash`)
          .set(auth(managerBToken))
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (await api().get(`/properties/${created.id}`).set(auth(ownerToken)))
        .status,
    ).toBe(200);
  });

  it('keeps a SOLD property company-wide with public-only fields after the sale', async () => {
    const created = await createAs(employeeAToken);
    const approved = await approve(managerAToken, created.id);
    expect(approved.status).toBe(200);
    const approvedReference = (approved.body.data as PropertySummary).reference;
    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: created.id },
      select: { contactId: true },
    });

    // The real Deal transition sets SOLD; reproducing it here keeps this test
    // focused on catalog visibility without creating financial rows.
    await ctx.prisma.property.update({
      where: { id: created.id },
      data: { status: 'SOLD' },
    });

    for (const token of [ownerToken, managerBToken, employeeBToken]) {
      const listed = await list(token, `?q=${approvedReference}`);
      expect(listed.items.some((item) => item.id === created.id)).toBe(true);
      const detail = await api()
        .get(`/properties/${created.id}`)
        .set(auth(token));
      expect(detail.status).toBe(200);
      expect((detail.body.data as PropertySummary).status).toBe('SOLD');
    }

    for (const token of [managerBToken, employeeBToken]) {
      const detail = await api()
        .get(`/properties/${created.id}`)
        .set(auth(token));
      const item = detail.body.data as PropertySummary;
      expect(item).toMatchObject({
        id: created.id,
        reference: approvedReference,
        status: 'SOLD',
        responsibleName: 'Company Employee A',
      });
      expect(item.contact).toBeUndefined();
      expect(item.contactId).toBeUndefined();
      expect(item.reviewNotes).toBeUndefined();
      expect(item.proposedOwner).toBeUndefined();
      expect(item.duplicateCandidateIds).toBeUndefined();
      const serialized = JSON.stringify(item);
      expect(serialized).not.toContain('Private Broker');
      expect(serialized).not.toContain('664');

      const imageResponse = await api()
        .get(`/properties/${created.id}/image`)
        .set(auth(token));
      expect(imageResponse.status).toBe(200);

      const contactResponse = await api()
        .get(`/contacts/${row.contactId}`)
        .set(auth(token));
      expect(contactResponse.status).toBe(404);
    }

    // Status filters distinguish the two published states.
    expect(
      (
        await list(
          managerBToken,
          `?q=${approvedReference}&status=SOLD`,
        )
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await list(
          managerBToken,
          `?q=${approvedReference}&status=AVAILABLE`,
        )
      ).items,
    ).toHaveLength(0);

    // The creator, their manager and OWNER keep their authorized private view.
    for (const token of [managerAToken, employeeAToken, ownerToken]) {
      const detail = await api()
        .get(`/properties/${created.id}`)
        .set(auth(token));
      expect(detail.status).toBe(200);
      expect(
        (detail.body.data as { contact?: unknown }).contact,
      ).toBeTruthy();
    }
  });

  it('searches and paginates all company-wide approved properties, not just the team', async () => {
    const district = `SEARCH-${randomUUID().slice(0, 8)}`;
    const first = await createAs(employeeAToken, { district });
    const second = await createAs(employeeAToken, { district });
    expect((await approve(managerAToken, first.id)).status).toBe(200);
    expect((await approve(managerAToken, second.id)).status).toBe(200);
    const firstApproved = (
      await ctx.prisma.property.findUniqueOrThrow({
        where: { id: first.id },
        select: { approvedReference: true },
      })
    ).approvedReference;
    const secondApproved = (
      await ctx.prisma.property.findUniqueOrThrow({
        where: { id: second.id },
        select: { approvedReference: true },
      })
    ).approvedReference;

    const firstPage = await list(
      managerBToken,
      `?q=${encodeURIComponent(district)}&limit=1`,
    );
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await list(
      managerBToken,
      `?q=${encodeURIComponent(district)}&limit=1&cursor=${firstPage.nextCursor}`,
    );
    const ids = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(ids.sort()).toEqual([first.id, second.id].sort());

    const byCode = await list(managerBToken, `?q=${firstApproved}`);
    expect(byCode.items.some((item) => item.id === first.id)).toBe(true);
    expect(
      (
        await list(employeeBToken, `?q=${encodeURIComponent(district)}`)
      ).items.map((item) => item.id).sort(),
    ).toEqual([first.id, second.id].sort());
    expect(
      (
        await list(
          managerBToken,
          `?q=${encodeURIComponent(district)}&status=AVAILABLE`,
        )
      ).items,
    ).toHaveLength(2);
    expect(
      (
        await list(
          managerBToken,
          `?q=${encodeURIComponent(district)}&status=PENDING`,
        )
      ).items,
    ).toHaveLength(0);
    expect(
      (
        await list(managerBToken, `?q=${secondApproved}`)
      ).items.some((item) => item.id === second.id),
    ).toBe(true);
  });

  it('keeps pending, rejected and trashed rows out of the shared catalog', async () => {
    const pending = await createAs(employeeAToken);
    const rejected = await createAs(employeeAToken);
    const trashed = await createAs(employeeAToken);
    expect(
      (
        await api()
          .post(`/properties/${rejected.id}/reject`)
          .set(auth(managerAToken))
          .send({ reason: 'سبب رفض للاختبار' })
      ).status,
    ).toBe(200);
    expect((await approve(managerAToken, trashed.id)).status).toBe(200);
    expect(
      (
        await api()
          .post(`/properties/${trashed.id}/trash`)
          .set(auth(ownerToken))
          .send({ reason: 'اختبار كتالوج' })
      ).status,
    ).toBe(200);

    for (const token of [managerBToken, employeeBToken]) {
      for (const property of [pending, rejected, trashed]) {
        expect(
          (
            await list(token, `?q=${property.reference}`)
          ).items.some((item) => item.id === property.id),
        ).toBe(false);
        expect(
          (
            await api()
              .get(`/properties/${property.id}`)
              .set(auth(token))
          ).status,
        ).toBe(404);
      }
    }

    // Creator/reviewer retain their legitimate private review access.
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(employeeAToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${rejected.id}`).set(auth(employeeAToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${rejected.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);
  });

  it('lets cross-team employees use an approved property in client matching without widening contacts', async () => {
    const created = await createAs(employeeAToken);
    expect((await approve(managerAToken, created.id)).status).toBe(200);

    const submitted = await api()
      .post('/client-reviews')
      .set(auth(employeeBToken))
      .send({
        kind: 'CREATION',
        name: 'عميل مطابقة عبر الفرق',
        phone: '66512345',
        addInterests: [
          { propertyId: created.id, reason: 'مطابقة عقار معتمد' },
        ],
      });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;
    const detail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(employeeBToken));
    expect(detail.status).toBe(200);
    expect(
      (detail.body.data as {
        proposed: { addInterests: Array<{ propertyId: string }> };
      }).proposed.addInterests.some((row) => row.propertyId === created.id),
    ).toBe(true);
  });
});
