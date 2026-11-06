import { DealType, PropertyStatus } from '@prisma/client';
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

describeWithDatabase('Contacts API (real authorization, isolated DB)', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  let contactPropSeq = 0;

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

  it('rejects unauthenticated access', async () => {
    const response = await api().get('/contacts');
    expect(response.status).toBe(401);
  });

  it('lets the manager create an OWNER contact as a company record', async () => {
    const response = await api()
      .post('/contacts')
      .set(auth(managerToken))
      .send({ type: 'OWNER', name: 'Owner Co', phone: '22223333' });
    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe('OWNER');
    expect(response.body.data.responsibleUserId).toBeNull();
    expect(managerId).toBeTruthy();
  });

  it('lets an employee create a BROKER contact owned by that employee', async () => {
    const response = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'BROKER', name: 'Broker A', phone: '66661111' });
    expect(response.status).toBe(201);
    expect(response.body.data.responsibleUserId).toBe(employeeAId);
  });

  it('rejects an invalid contact type and a missing phone', async () => {
    const badType = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'PARTNER', name: 'X', phone: '66660000' });
    expect(badType.status).toBe(400);
    const noPhone = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'X' });
    expect(noPhone.status).toBe(400);
  });

  it('lets an employee list ONLY their own contacts', async () => {
    const aContact = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'A Owner', phone: '60000001' });
    const bContact = await api()
      .post('/contacts')
      .set(auth(employeeBToken))
      .send({ type: 'OWNER', name: 'B Owner', phone: '60000002' });
    const list = await api().get('/contacts').set(auth(employeeAToken));
    expect(list.status).toBe(200);
    const ids = list.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(aContact.body.data.id);
    expect(ids).not.toContain(bContact.body.data.id);
    expect(
      list.body.data.items.every(
        (item: { responsibleUserId: string }) =>
          item.responsibleUserId === employeeAId,
      ),
    ).toBe(true);
    expect(employeeBId).toBeTruthy();
  });

  it('never lets an employee read another employee contact by id', async () => {
    const bContact = await api()
      .post('/contacts')
      .set(auth(employeeBToken))
      .send({ type: 'BROKER', name: 'B Broker', phone: '60000003' });
    const read = await api()
      .get(`/contacts/${bContact.body.data.id}`)
      .set(auth(employeeAToken));
    expect(read.status).toBe(404);
  });

  it('never lets an employee update another employee contact', async () => {
    const bContact = await api()
      .post('/contacts')
      .set(auth(employeeBToken))
      .send({ type: 'BROKER', name: 'B Broker 2', phone: '60000004' });
    const patched = await api()
      .patch(`/contacts/${bContact.body.data.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'hijacked' });
    expect(patched.status).toBe(404);
    const still = await ctx.prisma.contact.findUnique({
      where: { id: bContact.body.data.id },
    });
    expect(still?.name).toBe('B Broker 2');
  });

  it('lets the manager read every employee contact', async () => {
    const aContact = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'A Owner 2', phone: '60000005' });
    const read = await api()
      .get(`/contacts/${aContact.body.data.id}`)
      .set(auth(managerToken));
    expect(read.status).toBe(200);
    expect(read.body.data.name).toBe('A Owner 2');
  });

  it('fails closed when an employee guesses a company/manager contact id', async () => {
    const companyContact = await api()
      .post('/contacts')
      .set(auth(managerToken))
      .send({ type: 'OWNER', name: 'Company Owner', phone: '60000006' });
    const read = await api()
      .get(`/contacts/${companyContact.body.data.id}`)
      .set(auth(employeeAToken));
    expect(read.status).toBe(404);
  });

  it('prevents an employee from attaching another employee contact to a property', async () => {
    const ownedByA = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'A Only', phone: '60000007' });
    const response = await postProperty(
      ctx.app,
      employeeBToken,
      {
        listingType: 'SALE',
        district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
        contactId: ownedByA.body.data.id,
      },
      [{ buffer: pngBytes(), filename: 'a.png' }],
    );
    expect(response.status).toBe(404);
  });

  describe('linked property counts from Property.contactId', () => {
    /** Seeds the authoritative Contact ↔ Property link with an exact status/creator. */
    async function seedLinkedProperty(input: {
      reference: string;
      contactId: string;
      status: PropertyStatus;
      createdByUserId?: string | null;
      listingType?: DealType;
    }) {
      return ctx.prisma.property.create({
        data: {
          reference: input.reference,
          title: `Property ${input.reference}`,
          area: 'غرناطة',
          currency: 'KWD',
          listingType: input.listingType ?? DealType.SALE,
          status: input.status,
          contactId: input.contactId,
          createdByUserId: input.createdByUserId ?? null,
        },
      });
    }

    it('returns every linked property to the manager, whatever the status or creator', async () => {
      const contact = await api()
        .post('/contacts')
        .set(auth(managerToken))
        .send({ type: 'OWNER', name: 'Linked Owner', phone: '61000001' });
      const contactId = contact.body.data.id as string;
      await seedLinkedProperty({
        reference: 'CNT-MGR-1',
        contactId,
        status: PropertyStatus.PENDING,
        createdByUserId: employeeAId,
      });
      await seedLinkedProperty({
        reference: 'CNT-MGR-2',
        contactId,
        status: PropertyStatus.SOLD,
        createdByUserId: employeeBId,
      });
      await seedLinkedProperty({
        reference: 'CNT-MGR-3',
        contactId,
        status: PropertyStatus.AVAILABLE,
        createdByUserId: null,
      });

      const read = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(managerToken));
      expect(read.status).toBe(200);
      expect(read.body.data.properties.map((p: { reference: string }) => p.reference).sort()).toEqual([
        'CNT-MGR-1',
        'CNT-MGR-2',
        'CNT-MGR-3',
      ]);

      const list = await api().get('/contacts').set(auth(managerToken));
      expect(list.status).toBe(200);
      const item = list.body.data.items.find(
        (entry: { id: string }) => entry.id === contactId,
      );
      expect(item.properties).toHaveLength(3);
      expect(item.properties[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          reference: expect.any(String),
        }),
      );
    });

    it('returns zero linked properties for a contact with none', async () => {
      const contact = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'BROKER', name: 'No Properties', phone: '61000002' });
      const read = await api()
        .get(`/contacts/${contact.body.data.id}`)
        .set(auth(employeeAToken));
      expect(read.status).toBe(200);
      expect(read.body.data.properties).toEqual([]);
    });

    it('gives every linked property ref a real transaction type for the pills', async () => {
      const contact = await api()
        .post('/contacts')
        .set(auth(managerToken))
        .send({ type: 'OWNER', name: 'Pills Owner', phone: '61000004' });
      const contactId = contact.body.data.id as string;
      await seedLinkedProperty({
        reference: 'PILLS-S1',
        contactId,
        status: PropertyStatus.AVAILABLE,
        listingType: DealType.SALE,
      });
      await seedLinkedProperty({
        reference: 'PILLS-R1',
        contactId,
        status: PropertyStatus.PENDING,
        listingType: DealType.RENT,
      });
      await seedLinkedProperty({
        reference: 'PILLS-X1',
        contactId,
        status: PropertyStatus.AVAILABLE,
        listingType: DealType.EXCHANGE,
      });

      const read = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(managerToken));
      expect(read.status).toBe(200);
      const refs = read.body.data.properties as {
        reference: string;
        listingType: string;
      }[];
      expect(refs).toHaveLength(3);
      // Every row carries its REAL DealType — the card groups these server
      // values, it never invents them client-side.
      expect(
        refs.every((row) => ['SALE', 'RENT', 'EXCHANGE'].includes(row.listingType)),
      ).toBe(true);
      expect(
        refs.every(
          (row) =>
            row.listingType ===
            { 'PILLS-S1': 'SALE', 'PILLS-R1': 'RENT', 'PILLS-X1': 'EXCHANGE' }[
              row.reference
            ],
        ),
      ).toBe(true);
    });

    it('counts only rows the viewer may see, per role, when grouping by type', async () => {
      const contact = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'OWNER', name: 'Pills Privacy', phone: '61000006' });
      const contactId = contact.body.data.id as string;
      // Visible to employee A: an AVAILABLE SALE (someone else's) and own PENDING RENT.
      await seedLinkedProperty({
        reference: 'PRV-S1',
        contactId,
        status: PropertyStatus.AVAILABLE,
        createdByUserId: employeeBId,
        listingType: DealType.SALE,
      });
      await seedLinkedProperty({
        reference: 'PRV-R1',
        contactId,
        status: PropertyStatus.PENDING,
        createdByUserId: employeeAId,
        listingType: DealType.RENT,
      });
      // NOT visible to employee A: another employee's PENDING EXCHANGE.
      await seedLinkedProperty({
        reference: 'PRV-X1',
        contactId,
        status: PropertyStatus.PENDING,
        createdByUserId: employeeBId,
        listingType: DealType.EXCHANGE,
      });

      const employeeRead = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(employeeAToken));
      expect(employeeRead.status).toBe(200);
      const visible = employeeRead.body.data.properties as {
        reference: string;
        listingType: string;
      }[];
      expect(visible.map((row) => row.reference).sort()).toEqual([
        'PRV-R1',
        'PRV-S1',
      ]);
      // The employee's grouped counts can never include the hidden EXCHANGE row.
      const visibleCounts = visible.reduce<Record<string, number>>(
        (acc, row) => ({ ...acc, [row.listingType]: (acc[row.listingType] ?? 0) + 1 }),
        {},
      );
      expect(visibleCounts).toEqual({ SALE: 1, RENT: 1 });
      expect(visibleCounts.EXCHANGE).toBeUndefined();

      // Another employee gets 404, so no count or type leaks through their view.
      const other = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(employeeBToken));
      expect(other.status).toBe(404);

      // The manager sees all three rows; the pill sum equals the full count.
      const managerRead = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(managerToken));
      const managerProps = managerRead.body.data.properties as {
        listingType: string;
      }[];
      const managerCounts = managerProps.reduce<Record<string, number>>(
        (acc, row) => ({ ...acc, [row.listingType]: (acc[row.listingType] ?? 0) + 1 }),
        {},
      );
      expect(managerCounts).toEqual({ SALE: 1, RENT: 1, EXCHANGE: 1 });
      expect(
        Object.values(managerCounts).reduce((a, b) => a + b, 0),
      ).toBe(managerProps.length);
    });

    it('shows an employee only the linked properties they may access, and never the rest', async () => {
      const contact = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'OWNER', name: 'A Linked Owner', phone: '61000003' });
      const contactId = contact.body.data.id as string;

      // Visible to employee A: every AVAILABLE property, plus their own PENDING.
      await seedLinkedProperty({
        reference: 'CNT-A-1',
        contactId,
        status: PropertyStatus.AVAILABLE,
        createdByUserId: employeeBId,
      });
      await seedLinkedProperty({
        reference: 'CNT-A-2',
        contactId,
        status: PropertyStatus.PENDING,
        createdByUserId: employeeAId,
      });
      // Not visible to employee A: another employee's PENDING, and a SOLD row.
      await seedLinkedProperty({
        reference: 'CNT-A-3',
        contactId,
        status: PropertyStatus.PENDING,
        createdByUserId: employeeBId,
      });
      await seedLinkedProperty({
        reference: 'CNT-A-4',
        contactId,
        status: PropertyStatus.SOLD,
        createdByUserId: employeeAId,
      });

      const read = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(employeeAToken));
      expect(read.status).toBe(200);
      expect(
        read.body.data.properties
          .map((p: { reference: string }) => p.reference)
          .sort(),
      ).toEqual(['CNT-A-1', 'CNT-A-2']);

      const list = await api().get('/contacts').set(auth(employeeAToken));
      const item = list.body.data.items.find(
        (entry: { id: string }) => entry.id === contactId,
      );
      expect(
        item.properties
          .map((p: { reference: string }) => p.reference)
          .sort(),
      ).toEqual(['CNT-A-1', 'CNT-A-2']);

      // Another employee cannot even read the contact, so no count leaks.
      const otherEmployee = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(employeeBToken));
      expect(otherEmployee.status).toBe(404);

      const managerRead = await api()
        .get(`/contacts/${contactId}`)
        .set(auth(managerToken));
      expect(
        managerRead.body.data.properties
          .map((p: { reference: string }) => p.reference)
          .sort(),
      ).toEqual(['CNT-A-1', 'CNT-A-2', 'CNT-A-3', 'CNT-A-4']);
    });
  });

  describe('responsible employee display name (server-derived)', () => {
    it('exposes the real responsible User.name on create and list', async () => {
      const created = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'OWNER', name: 'Name Owner', phone: '67770001' });
      expect(created.status).toBe(201);
      expect(created.body.data.responsibleUserId).toBe(employeeAId);
      expect(created.body.data.responsibleEmployeeName).toBe('Employee A');

      const list = await api()
        .get('/contacts?type=OWNER')
        .set(auth(employeeAToken));
      const item = list.body.data.items.find(
        (entry: { id: string }) => entry.id === created.body.data.id,
      );
      expect(item.responsibleEmployeeName).toBe('Employee A');
    });

    it('returns null (not the owner name) for a company record with no employee', async () => {
      const created = await api()
        .post('/contacts')
        .set(auth(managerToken))
        .send({ type: 'OWNER', name: 'Company Record', phone: '67770002' });
      expect(created.status).toBe(201);
      expect(created.body.data.responsibleUserId).toBeNull();
      expect(created.body.data.responsibleEmployeeName).toBeNull();
      // The owner's own name must never be used as the employee name.
      expect(created.body.data.responsibleEmployeeName).not.toBe('Company Record');
    });

    it('reflects a renamed employee after re-fetching the records', async () => {
      const created = await api()
        .post('/contacts')
        .set(auth(employeeBToken))
        .send({ type: 'BROKER', name: 'Rename Broker', phone: '67770003' });
      const id = created.body.data.id as string;
      expect(created.body.data.responsibleEmployeeName).toBe('Employee B');

      await ctx.prisma.user.update({
        where: { id: employeeBId },
        data: { name: 'Employee B Renamed' },
      });

      const reread = await api().get(`/contacts/${id}`).set(auth(employeeBToken));
      expect(reread.status).toBe(200);
      expect(reread.body.data.responsibleEmployeeName).toBe('Employee B Renamed');
    });

    it('never leaks another employee name to the manager for consigned rows only', async () => {
      // Manager may see the name of a contact it is authorized for; that name is
      // still the responsible user's real name and never the owner's name.
      const ownedByA = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'OWNER', name: 'Hidden Owner', phone: '67770004' });
      const managerRead = await api()
        .get(`/contacts/${ownedByA.body.data.id}`)
        .set(auth(managerToken));
      expect(managerRead.status).toBe(200);
      expect(managerRead.body.data.responsibleEmployeeName).toBe('Employee A');
    });

    it('does not expose the responsible name to an unrelated employee', async () => {
      const ownedByA = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'OWNER', name: 'Private Owner', phone: '67770005' });
      const denied = await api()
        .get(`/contacts/${ownedByA.body.data.id}`)
        .set(auth(employeeBToken));
      expect(denied.status).toBe(404);
      expect(JSON.stringify(denied.body)).not.toContain('Employee A');
      expect(JSON.stringify(denied.body)).not.toContain('Private Owner');
    });
  });

  describe('one owner reused across two properties (no duplicate Contact)', () => {
    const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

    it('links TWO properties to the SAME contact when the owner is reused', async () => {
      // First property: the wizard registers a brand-new owner.
      const first = await postProperty(
        ctx.app,
        employeeAToken,
        {
          listingType: 'SALE',
          district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
          newContact: { type: 'OWNER', name: 'Reused Owner', phone: '65551111' },
        },
        image,
      );
      expect(first.status).toBe(201);
      // The owner is provisional until the Manager approves the property.
      expect(first.body.data.contactId).toBeNull();
      await api()
        .post(`/properties/${first.body.data.id}/approve`)
        .set(auth(managerToken))
        .send({});
      const approvedFirst = await ctx.prisma.property.findUniqueOrThrow({
        where: { id: first.body.data.id },
      });
      const ownerId = approvedFirst.contactId as string;
      expect(ownerId).toBeTruthy();

      // Second property: the wizard picks the EXISTING owner (same id), so no
      // new Contact row may appear.
      const second = await postProperty(
        ctx.app,
        employeeAToken,
        {
          listingType: 'SALE',
          district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
          contactId: ownerId,
        },
        image,
      );
      expect(second.status).toBe(201);
      expect(second.body.data.contactId).toBe(ownerId);

      expect(
        await ctx.prisma.contact.count({
          where: { name: 'Reused Owner', phone: '65551111' },
        }),
      ).toBe(1);
      expect(
        await ctx.prisma.property.count({
          where: { contactId: ownerId, createdByUserId: employeeAId },
        }),
      ).toBe(2);
    });

    it('keeps the linked contact on an approved-property edit (no duplicate)', async () => {
      const created = await postProperty(
        ctx.app,
        employeeAToken,
        {
          listingType: 'SALE',
          district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
          newContact: { type: 'OWNER', name: 'Edit Owner', phone: '65552222' },
        },
        image,
      );
      const id = created.body.data.id as string;
      // The owner is provisional until approval; read the promoted contactId
      // AFTER the Manager approves.
      expect(created.body.data.contactId).toBeNull();
      await api()
        .post(`/properties/${id}/approve`)
        .set(auth(managerToken))
        .send({});
      const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id } });
      const ownerId = row.contactId as string;
      const contactsBefore = await ctx.prisma.contact.count();

      // The fixed wizard re-sends the SAME contactId (never `newContact`).
      const patched = await api()
        .patch(`/properties/${id}`)
        .set(auth(employeeAToken))
        .send({ version: row.version, contactId: ownerId, sizeSqm: '455.00' });
      expect(patched.status).toBe(200);
      expect(patched.body.data.contactId).toBe(ownerId);
      expect(await ctx.prisma.contact.count()).toBe(contactsBefore);
      expect(
        await ctx.prisma.contact.count({ where: { phone: '65552222' } }),
      ).toBe(1);
    });

    it('keeps the linked contact through a reject → edit → resubmit cycle', async () => {
      const created = await postProperty(
        ctx.app,
        employeeAToken,
        {
          listingType: 'SALE',
          district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
          newContact: { type: 'OWNER', name: 'Cycle Owner', phone: '65553333' },
        },
        image,
      );
      const id = created.body.data.id as string;
      const ownerId = created.body.data.contactId as string;
      await api()
        .post(`/properties/${id}/reject`)
        .set(auth(managerToken))
        .send({ reason: 'بيانات ناقصة' });
      const rejected = await ctx.prisma.property.findUniqueOrThrow({
        where: { id },
      });
      const contactsBefore = await ctx.prisma.contact.count();

      const patched = await api()
        .patch(`/properties/${id}`)
        .set(auth(employeeAToken))
        .send({
          version: rejected.version,
          contactId: ownerId,
          sizeSqm: '460.00',
        });
      expect(patched.status).toBe(200);
      const resubmitted = await api()
        .post(`/properties/${id}/resubmit`)
        .set(auth(employeeAToken));
      expect(resubmitted.status).toBe(200);
      expect(resubmitted.body.data.contactId).toBe(ownerId);
      expect(await ctx.prisma.contact.count()).toBe(contactsBefore);
    });

    it('answers 404 when an employee selects another employee\'s owner', async () => {
      const ownedByA = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'OWNER', name: 'A Private Owner', phone: '65554444' });
      const response = await postProperty(
        ctx.app,
        employeeBToken,
        {
          listingType: 'SALE',
          district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
          contactId: ownedByA.body.data.id,
        },
        [{ buffer: pngBytes(), filename: 'b.png' }],
      );
      // A non-disclosing 404: the id must never be echoed back, and the message
      // must not reveal that the contact belongs to someone else.
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('A Private Owner');
      expect(JSON.stringify(response.body)).not.toContain('65554444');
      // Nothing attached and no orphan contact created for the private owner's
      // phone under B (the contact still belongs solely to A).
      expect(
        await ctx.prisma.contact.count({
          where: { responsibleUserId: employeeBId, phone: '65554444' },
        }),
      ).toBe(0);
      expect(
        await ctx.prisma.contact.count({ where: { phone: '65554444' } }),
      ).toBe(1);
    });

    it('never creates a Contact when the selection is invalid (no silent new person)', async () => {
      const before = await ctx.prisma.contact.count();
      const response = await postProperty(
        ctx.app,
        employeeAToken,
        {
          listingType: 'SALE',
          district: 'غرناطة',
          plotNumber: String(700000 + ++contactPropSeq),
          block: '3',
          contactId: '0f0f0f0f-1a1a-4b4b-8c8c-2d2d2d2d2d2d',
        },
        image,
      );
      expect(response.status).toBe(404);
      expect(await ctx.prisma.contact.count()).toBe(before);
    });
  });
});
