import { Role } from '@arkan/shared';
import { randomUUID } from 'node:crypto';
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

jest.setTimeout(120000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

interface CreatedProperty {
  id: string;
  reference: string;
  /** Original P submission code, kept for traceability after approval. */
  submissionReference: string;
  version: number;
  status: string;
  district: string | null;
  contact: { name: string; phone: string } | null;
  contactId: string | null;
}

/**
 * Cross-account property discovery + ClientPropertyInterest linking.
 *
 * Proves the EXACT scenario behind the wizard's real property search:
 * a property created by Employee A and approved by the manager must be
 * discoverable by Employee B through `GET /properties?q=&status=AVAILABLE`,
 * linkable to B's OWN client (`ClientPropertyInterest`), and readable again
 * after reopening — while A's private contact/clients and any non-public
 * property stay completely out of B's reach. Manager keeps full visibility.
 */
describeWithDatabase(
  'Cross-employee property search + interest linking (isolated DB)',
  () => {
    let ctx: TestContext;
    let managerToken: string;
    let employeeAToken: string;
    let employeeBToken: string;

    const api = () => request(ctx.app.getHttpServer());

    /** Unique, private-by-construction district marker for a clean search. */
    const payload = (overrides: Record<string, unknown> = {}) => ({
      listingType: 'SALE',
      governorate: 'العاصمة',
      district: `حي-${randomUUID().slice(0, 8).toUpperCase()}`,
      block: '1',
      plotNumber: '1',
      sizeSqm: '300.00',
      askingPrice: '180000.00',
      negotiable: true,
      description: 'شقة متاحة للبيع',
      // A private BROKER contact owned by the creating employee must never
      // surface to another employee searching or linking this property.
      newContact: { type: 'BROKER', name: 'وسيط خاص جداً', phone: '66662222' },
      ...overrides,
    });

    const createProperty = async (
      token: string,
      overrides: Record<string, unknown> = {},
    ): Promise<{ property: CreatedProperty; marker: string }> => {
      const body = payload(overrides);
      const response = await postProperty(ctx.app, token, body, image);
      expect(response.status).toBe(201);
      return {
        property: response.body.data as CreatedProperty,
        marker: (body.district as string),
      };
    };

    const search = async (token: string, q: string) => {
      const response = await api()
        .get(`/properties?q=${encodeURIComponent(q)}&status=AVAILABLE&limit=20`)
        .set(auth(token));
      expect(response.status).toBe(200);
      return response.body.data.items as CreatedProperty[];
    };

    beforeAll(async () => {
      ctx = await createTestApp();
      await resetDatabase(ctx.prisma);
      const manager = await createUser(ctx.prisma, {
        email: 'manager-cross@search.local',
        name: 'Manager Cross',
        role: Role.MANAGER,
      });
      const employeeA = await createUser(ctx.prisma, {
        email: 'employee.a.cross@search.local',
        name: 'Employee A Cross',
        role: Role.EMPLOYEE,
      });
      const employeeB = await createUser(ctx.prisma, {
        email: 'employee.b.cross@search.local',
        name: 'Employee B Cross',
        role: Role.EMPLOYEE,
      });
      managerToken = await login(ctx.app, manager.email);
      employeeAToken = await login(ctx.app, employeeA.email);
      employeeBToken = await login(ctx.app, employeeB.email);
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('Employee A creates, manager approves, Employee B searches/sees/links/reopens', async () => {
      // 1) Employee A creates a property (starts PENDING).
      const { property, marker } = await createProperty(employeeAToken);
      expect(property.status).toBe('PENDING');
      // A's PENDING property is NOT yet searchable by anyone else.
      expect(await search(employeeBToken, marker)).toHaveLength(0);

      // 2) Manager approves it → AVAILABLE.
      const approved = await api()
        .post(`/properties/${property.id}/approve`)
        .set(auth(managerToken))
        .send({ version: property.version });
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe('AVAILABLE');

      // 3) Employee B searches by the district and sees the REAL row —
      //    with public listing fields only, no private contact data.
      const results = await search(employeeBToken, marker);
      const found = results.find((row) => row.id === property.id);
      expect(found).toBeDefined();
      // Approved rows expose the OFFICIAL A code, while the original P
      // submission code stays available for traceability.
      expect(found?.reference).toBe(approved.body.data.reference);
      expect(found?.reference).toMatch(/^A-/);
      expect(found?.submissionReference).toBe(property.reference);
      expect(found?.status).toBe('AVAILABLE');
      // Privacy: no Contact object/owner phone travels to a non-creator.
      expect(found?.contact ?? null).toBeNull();
      expect(found?.contactId ?? null).toBeNull();

      // 4) Employee B selects it for THEIR OWN client — staged as a review,
      //    which the manager approves; only then is the client materialized.
      const saved = await api()
        .post('/client-reviews')
        .set(auth(employeeBToken))
        .send({
          kind: 'CREATION',
          name: 'عميل الموظف ب',
          phone: `71${randomUUID().slice(0, 8).replace(/[^0-9a-f]/g, '1')}`,
          addInterests: [
            {
              propertyId: property.id,
              reason: 'استفسار',
              notes: 'العميل سأل عن العقار المعروض',
            },
          ],
        });
      expect(saved.status).toBe(201);
      const claimed = await api()
        .post(
          `/client-reviews/${(saved.body.data as { id: string }).id}/approve`,
        )
        .set(auth(managerToken))
        .send({});
      expect(claimed.status).toBe(201);
      const clientId = (claimed.body.data as { clientId: string }).clientId;

      // 5) Reopening THEIR client shows the linked property, by Property.id.
      const reopened = await api()
        .get(`/clients/${clientId}`)
        .set(auth(employeeBToken));
      expect(reopened.status).toBe(200);
      const interests = (reopened.body.data as {
        propertyInterests: {
          propertyId: string;
          reference: string;
          askingPrice: string | null;
          reason: string;
        }[];
      }).propertyInterests;
      expect(interests).toHaveLength(1);
      expect(interests[0]?.propertyId).toBe(property.id);
      // The durable interest exposes the CURRENT official code (A); the P
      // submission code remains only on the property's own history fields.
      expect(interests[0]?.reference).toBe(approved.body.data.reference);
      expect(interests[0]?.reference).toMatch(/^A-/);
      expect(interests[0]?.reason).toBe('استفسار');

      // The durable relationship really exists — exactly one row.
      expect(
        await ctx.prisma.clientPropertyInterest.count({
          where: { clientId, propertyId: property.id },
        }),
      ).toBe(1);

      // 6) Privacy intact: the property detail for B still leaks nothing,
      //    and A's OWN client stays invisible to B.
      const detail = await api()
        .get(`/properties/${property.id}`)
        .set(auth(employeeBToken));
      expect(detail.status).toBe(200);
      expect(detail.body.data.contact ?? null).toBeNull();
      // Fixture client of A (rows not owned/responsible by B stay invisible).
      await api().post('/clients').set(auth(managerToken)).send({
        name: 'عميل الموظف أ',
        phone: `72${randomUUID().slice(0, 8).replace(/[^0-9a-f]/g, '2')}`,
      });
      const bView = await api().get('/clients').set(auth(employeeBToken));
      const bNames = (bView.body.data.items as { name: string }[]).map(
        (row) => row.name,
      );
      expect(bNames).toContain('عميل الموظف ب');
      expect(bNames).not.toContain('عميل الموظف أ');

      // 7) A SEPARATE PENDING property from A stays invisible to B.
      const { property: pending, marker: pendingMarker } =
        await createProperty(employeeAToken);
      expect(pending.status).toBe('PENDING');
      expect(await search(employeeBToken, pendingMarker)).toHaveLength(0);
      expect(
        (await api().get(`/properties/${pending.id}`).set(auth(employeeBToken)))
          .status,
      ).toBe(404);

      // 8) The manager can search and see the approved property too.
      const managerResults = await search(managerToken, marker);
      expect(managerResults.some((row) => row.id === property.id)).toBe(true);
    });

    it('same-employee selection still works end-to-end', async () => {
      const { property, marker } = await createProperty(employeeAToken);
      const approved = await api()
        .post(`/properties/${property.id}/approve`)
        .set(auth(managerToken))
        .send({ version: property.version });
      expect(approved.status).toBe(200);
      expect(await search(employeeAToken, marker)).toHaveLength(1);

      const saved = await api()
        .post('/client-reviews')
        .set(auth(employeeAToken))
        .send({
          kind: 'CREATION',
          name: 'عميل الموظف أ',
          phone: `73${randomUUID().slice(0, 8).replace(/[^0-9a-f]/g, '3')}`,
          addInterests: [{ propertyId: property.id }],
        });
      expect(saved.status).toBe(201);
      const claimed = await api()
        .post(
          `/client-reviews/${(saved.body.data as { id: string }).id}/approve`,
        )
        .set(auth(managerToken))
        .send({});
      expect(claimed.status).toBe(201);
      expect(
        await ctx.prisma.clientPropertyInterest.count({
          where: { propertyId: property.id },
        }),
      ).toBe(1);
    });
  },
);
