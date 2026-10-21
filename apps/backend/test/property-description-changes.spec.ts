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
import { descriptionTextSignature } from '../src/properties/property-changes';

jest.setTimeout(120000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

/**
 * The "الوصف" false positive.
 *
 * The wizard stores its whole form in the property's `description` column, so
 * editing the price, the area or the location necessarily rewrites that text.
 * The change comparison must therefore compare the description SEMANTICALLY:
 * a description is only "changed" when its own public content moved — never
 * because a field that is reported on its own was rewritten inside it.
 */
describeWithDatabase('Description change detection', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;

  const api = () => request(ctx.app.getHttpServer());

  /** The wizard's structured description (the same envelope it stores). */
  const wizardDescription = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify(
      {
        entryMethod: 'MANUAL',
        operation: 'بيع',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: '12',
        area: '400',
        landArea: '',
        unitArea: '',
        hasBasement: false,
        basementDetails: '',
        hasHalfFloor: false,
        halfFloorDetails: '',
        hasQuarterFloor: false,
        quarterFloorDetails: '',
        floorCount: 1,
        floors: [{ label: 'الأرضي', customLabel: '', details: 'صالة' }],
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
        ...overrides,
      },
      null,
      2,
    );

  const createProperty = async (description: string) => {
    const response = await postProperty(
      ctx.app,
      employeeToken,
      {
        listingType: 'SALE',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: '12',
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description,
        floors: [{ type: 'GROUND', details: 'صالة' }],
        newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
      },
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  };

  const approve = (id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

  const reviewAlerts = async () => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(managerToken));
    expect(response.status).toBe(200);
    return (
      response.body.data as {
        items: { type: string; title: string; message: string }[];
      }
    ).items.filter((item) => item.type === 'PROPERTY_RESUBMITTED');
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@description.local',
      name: 'Manager Description',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'employee@description.local',
      name: 'Employee Description',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  it('does NOT report "الوصف" when only the price changed (wizard description)', async () => {
    const created = await createProperty(wizardDescription());
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    // The wizard re-serializes its form, so the stored description text
    // changes together with the price — the description itself did NOT change.
    await ctx.prisma.notification.deleteMany({});
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({
        version: approved?.version,
        askingPrice: '300000.00',
        description: wizardDescription({ price: '300000' }),
      });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).toContain('السعر');
    expect(alerts[0]?.message).not.toContain('الوصف');
  });

  it('does NOT report "الوصف" when only the location or the area changed', async () => {
    const created = await createProperty(wizardDescription());
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({
        version: approved?.version,
        district: 'الجهراء',
        governorate: 'الجهراء',
        description: wizardDescription({ district: 'الجهراء' }),
      });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).toContain('المنطقة');
    expect(alerts[0]?.message).not.toContain('الوصف');
  });

  it('reports a wizard-only description field with its OWN label', async () => {
    const created = await createProperty(wizardDescription());
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({
        version: approved?.version,
        // A real change of a description field that has no column of its own
        // (the basement) — it is reported with its own name, not hidden
        // inside "الوصف".
        description: wizardDescription({
          hasBasement: true,
          basementDetails: 'سرداب واسع',
        }),
      });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).toContain('سرداب');
    expect(alerts[0]?.message).not.toContain('الوصف');
    // The description text itself is never copied into the preview.
    expect(alerts[0]?.message).not.toContain('سرداب واسع');
  });

  it('reports "الوصف" when the free text of the description really changed', async () => {
    const created = await createProperty('بيت مستقل للبيع');
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({
        version: approved?.version,
        description: 'بيت مستقل للبيع مع ملحق أرضي',
      });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).toContain('الوصف');
    expect(alerts[0]?.message).not.toContain('ملحق أرضي');
  });

  it('ignores a formatting-only difference in a free-text description', async () => {
    const created = await createProperty('  بيت مستقل للبيع  ');
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({
        version: approved?.version,
        description: 'بيت مستقل للبيع',
      });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).not.toContain('الوصف');
  });

  it('compares descriptions semantically (the shared signature)', () => {
    // The same form with a different price: the tracked fields differ, the
    // FREE TEXT of the description does not.
    expect(descriptionTextSignature(wizardDescription())).toBe(
      descriptionTextSignature(wizardDescription({ price: '300000' })),
    );
    // A real free-text change is visible.
    expect(descriptionTextSignature('بيت  مستقل')).toBe(
      descriptionTextSignature('بيت مستقل'),
    );
    expect(descriptionTextSignature('بيت مستقل')).not.toBe(
      descriptionTextSignature('بيت مستقل مع ملحق'),
    );
  });
});
