import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  jpegBytes,
  login,
  pngBytes,
  postProperty,
  resetDatabase,
  textBytes,
  webpBytes,
  type TestContext,
} from './support/test-app';

jest.setTimeout(60000);

const okImage = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('Property images + EXCHANGE (storage, validation, mapping)', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    district: 'السالمية',
    block: '5',
    plotNumber: String(800000 + ++seq),
    newContact: { type: 'OWNER', name: 'Owner', phone: '22221111' },
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
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects a missing image and leaves no orphan contact/property behind', async () => {
    const contactsBefore = await ctx.prisma.contact.count();
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      payload(),
      [],
    );
    expect(response.status).toBe(400);
    expect(await ctx.prisma.contact.count()).toBe(contactsBefore);
  });

  it('rejects more than one image', async () => {
    const response = await postProperty(ctx.app, employeeAToken, payload(), [
      { buffer: pngBytes(), filename: 'a.png' },
      { buffer: jpegBytes(), filename: 'b.jpg' },
    ]);
    expect(response.status).toBe(400);
  });

  it('rejects unsupported file content (extension is not trusted)', async () => {
    const response = await postProperty(ctx.app, employeeAToken, payload(), [
      { buffer: textBytes(), filename: 'fake.png' },
    ]);
    expect(response.status).toBe(400);
  });

  it('rejects an oversized image', async () => {
    const response = await postProperty(ctx.app, employeeAToken, payload(), [
      { buffer: pngBytes(5 * 1024 * 1024), filename: 'big.png' },
    ]);
    expect([400, 413]).toContain(response.status);
  });

  it('accepts JPEG and WebP signatures', async () => {
    const jpeg = await postProperty(ctx.app, employeeAToken, payload(), [
      { buffer: jpegBytes(), filename: 'x.jpg' },
    ]);
    expect(jpeg.status).toBe(201);
    const webp = await postProperty(ctx.app, employeeAToken, payload(), [
      { buffer: webpBytes(), filename: 'x.webp' },
    ]);
    expect(webp.status).toBe(201);
  });

  it('never exposes storage keys, buckets or disk paths in responses', async () => {
    const created = await postProperty(ctx.app, employeeAToken, payload(), okImage);
    const serialized = JSON.stringify(created.body);
    expect(serialized).not.toContain(ctx.storageRoot);
    expect(serialized).not.toContain('bucket');
    expect(serialized).not.toContain('"key"');
    expect(created.body.data.primaryImageUrl).toBe(
      `/properties/${created.body.data.id}/image`,
    );
  });

  it('protects a PENDING image from other employees and serves it to authorized viewers', async () => {
    const created = await postProperty(ctx.app, employeeAToken, payload(), okImage);
    const id = created.body.data.id;
    const url = `/properties/${id}/image`;
    expect((await api().get(url).set(auth(employeeBToken))).status).toBe(404);
    expect((await api().get(url).set(auth(employeeAToken))).status).toBe(200);
    expect((await api().get(url).set(auth(managerToken))).status).toBe(200);

    await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});
    const afterApproval = await api().get(url).set(auth(employeeBToken));
    expect(afterApproval.status).toBe(200);
    expect(afterApproval.headers['content-type']).toBe('image/png');
    expect(afterApproval.headers['cache-control']).toContain('private');
    expect(afterApproval.headers['content-disposition']).toBe('inline');
  });

  it('requires authentication for image access', async () => {
    const created = await postProperty(ctx.app, employeeAToken, payload(), okImage);
    const response = await api().get(`/properties/${created.body.data.id}/image`);
    expect(response.status).toBe(401);
  });

  it('persists EXCHANGE requested-property data (min + max budget)', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        listingType: 'EXCHANGE',
        requestedProperty: {
          governorate: 'حولي',
          district: 'الجابرية',
          block: '2',
          plotNumber: '9',
          sizeSqm: '300.00',
          floorRequirements: 'أرضي وأول',
          notes: 'قريب من الخدمات',
          budgetMin: '100000.00',
          budgetMax: '150000.00',
        },
      }),
      okImage,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.requestedProperty.district).toBe('الجابرية');
    expect(response.body.data.requestedProperty.budgetMin).toBe('100000');
    expect(response.body.data.requestedProperty.budgetMax).toBe('150000');
  });

  it('accepts min-only and max-only budgets and rejects an invalid range', async () => {
    const minOnly = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        listingType: 'EXCHANGE',
        requestedProperty: { budgetMin: '50000.00' },
      }),
      okImage,
    );
    expect(minOnly.status).toBe(201);
    expect(minOnly.body.data.requestedProperty.budgetMax).toBeNull();

    const maxOnly = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        listingType: 'EXCHANGE',
        requestedProperty: { budgetMax: '80000.00' },
      }),
      okImage,
    );
    expect(maxOnly.status).toBe(201);
    expect(maxOnly.body.data.requestedProperty.budgetMin).toBeNull();

    const invalid = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        listingType: 'EXCHANGE',
        requestedProperty: { budgetMin: '200000.00', budgetMax: '100000.00' },
      }),
      okImage,
    );
    expect(invalid.status).toBe(400);
  });

  it('rejects a negative budget and negative price', async () => {
    const negativeBudget = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        listingType: 'EXCHANGE',
        requestedProperty: { budgetMin: '-1' },
      }),
      okImage,
    );
    expect(negativeBudget.status).toBe(400);
    const negativePrice = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ askingPrice: '-5' }),
      okImage,
    );
    expect(negativePrice.status).toBe(400);
  });

  it('rejects a floor detail that embeds a phone number', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ floors: [{ type: 'GROUND', details: 'اتصل 66667777' }] }),
      okImage,
    );
    expect(response.status).toBe(400);
  });

  it('maps floors to the approved FloorType interface in order', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        floors: [
          { type: 'BASEMENT', details: 'قبو' },
          { type: 'GROUND', details: 'أرضي' },
          { type: 'HALF', details: 'نصف دور' },
          { type: 'QUARTER', details: 'ربع دور' },
          { type: 'ROOF' },
        ],
      }),
      okImage,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.floors.map((floor: { type: string }) => floor.type)).toEqual([
      'BASEMENT',
      'GROUND',
      'HALF',
      'QUARTER',
      'ROOF',
    ]);
  });

  it('never fabricates a legacy Owner record for a broker-only submission', async () => {
    await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        newContact: { type: 'BROKER', name: 'Only Broker', phone: '65554444' },
      }),
      okImage,
    );
    expect(await ctx.prisma.owner.count()).toBe(0);
  });

  it('applies exactly the expected, reviewed migration history', async () => {
    // A deliberate canary: any migration that is not part of the reviewed history
    // (an accidental `db push`, a hand-written migration, a reset artifact) makes
    // this assertion fail so it must be updated on purpose.
    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{ migration_name: string }>
    >(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );
    expect(rows.map((row) => row.migration_name).sort()).toEqual([
      '20260907000000_initial',
      '20260907100000_mvp_schema_refinements',
      '20261015100000_property_schema_expansion',
      // Added by the in-app notifications task: an additive notification-events
      // migration (new enum + two nullable/defaulted columns + one unique index).
      '20261017120000_notification_events',
      // Added by the OWNER-APPROVED client→property interest persistence:
      // an additive `ClientPropertyInterest` table only (new table + indexes +
      // FKs; no change to any existing table or row).
      '20261020014757_client_property_interest',
      // Added by the centralized employee-activity notifications: six appended
      // NotificationType values + one nullable `contactId` FK (no column is
      // dropped, no row is touched; the legacy `ownerId` stays untouched).
      '20261020120000_notification_record_events',
      // Added by the sequential property codes: the atomic counter table + the
      // one-time renumbering of the existing rows (the rows are only updated,
      // never deleted or recreated) + the indexed prefix lookup.
      '20261021120000_property_codes_sequential',
      // Added by the Web Push phase: a nullable `lineageId` on the session
      // table (stable device lineage across refresh rotations) + the new
      // `PushSubscription` table (additive only; existing sessions keep
      // working and simply carry no lineage).
      '20261021120000_push_subscriptions_and_session_lineage',
      // Added by the wizard request-document hydration: an additive `requestData`
      // text column on the client table only.
      '20261021232825_client_request_data',
      // Added by the OWNER-APPROVED client approval workflow: a new
      // `ClientReviewRequest` table + partial unique indexes + `Notification.
      // clientReviewId` FK + 5 appended ClientReviewKind/NotificationType
      // enum values (no existing column or row is touched).
      '20261022040000_client_review_requests',
      // Added by the employee follow-ups: the durable `FollowUpSubject`/`FollowUpEntry`
      // tables + 2 appended NotificationType values + the `Notification.
      // followUpSubjectId` FK (additive only; no existing column or row touched).
      '20261024120000_follow_up_subjects',
      // Added by the MANAGER follow-ups (PREPARED — applied only where
      // explicitly approved): nullable `responsibleUserId`/`authorUserId`
      // user-level responsibility columns + `Client.createdByUserId` +
      // `FollowUpReminder` audit table + 1 appended NotificationType value
      // (additive only; every existing row keeps its exact current shape).
      '20261025090000_manager_followups',
      '20261026000000_manager_followup_notifications',
      '20261030111823_property_registrants_priority',
      '20261030111906_property_registrants_priority',
      '20261030112154_priority_notification_type',
      // Added by the Manager Trash: nullable soft-delete markers + the
      // immutable `PropertyTombstone` table (additive only).
      '20261104120000_property_trash_and_tombstone',
      // Added by the employee-submitted owner lifecycle: the nullable
      // `proposedOwner` JSON column, promoted to a real Contact only at
      // approval.
      '20261104130000_property_proposed_owner',
      // Added by the P/A numbering: the nullable unique `approvedReference`
      // column + the submission sequence row (existing rows are backfilled,
      // never deleted).
      '20261104160000_property_pa_numbering',
      // Added by the OWNER/MANAGER/EMPLOYEE hierarchy: the appended OWNER
      // role value.
      '20261108090000_add_owner_role',
      // Added by the hierarchy: session authVersion columns, the indexed
      // EmployeeProfile.managerUserId assignment and the ManagerCapability
      // table (additive only; existing rows keep their data).
      '20261108090100_owner_hierarchy',
      // Defense-in-depth session revocation: authVersion + refresh-token
      // revocation triggers for any role change or deactivation.
      '20261108090200_auth_revocation_triggers',
    ]);
  });
});
