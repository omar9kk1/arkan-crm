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
import { notificationRoute } from '../../frontend/features/notifications/notification-target';
import { notificationAffectsPropertyLists } from '../../frontend/features/notifications/view';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('Employee PENDING property edits', () => {
  let ctx: TestContext;
  let managerToken: string;
  let managerId: string;
  let employeeToken: string;
  let employeeId: string;
  let otherEmployeeToken: string;
  let seq = 0;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      listingType: 'SALE',
      governorate: 'الجهراء',
      district: 'مدينة المطلاع',
      block: '8',
      plotNumber: String(970000 + seq),
      sizeSqm: '300.00',
      askingPrice: '350000.00',
      negotiable: true,
      description: 'منزل كامل',
      floors: [{ type: 'GROUND', details: 'مجلس + ديوانية' }],
      newContact: { type: 'OWNER', name: 'Edit Owner', phone: '61110000' },
      ...overrides,
    };
  };

  const createAs = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const created = await postProperty(
      ctx.app,
      token,
      payload(overrides),
      image,
    );
    expect(created.status).toBe(201);
    return created.body.data as {
      id: string;
      reference: string;
      submissionReference: string;
      approvedReference: string | null;
      status: string;
      version: number;
      plotNumber: string | null;
    };
  };

  const patch = (token: string, id: string, body: Record<string, unknown>) =>
    api().patch(`/properties/${id}`).set(auth(token)).send(body);

  const get = (token: string, id: string) =>
    api().get(`/properties/${id}`).set(auth(token));

  const notificationsFor = async (propertyId: string) =>
    ctx.prisma.notification.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'asc' },
    });

  const latestApproval = async (propertyId: string) =>
    ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'edit-manager@test.local',
      name: 'مدير التعديلات',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'edit-employee@test.local',
      name: 'موظف التعديل',
      role: Role.EMPLOYEE,
    });
    const other = await createUser(ctx.prisma, {
      email: 'edit-other@test.local',
      name: 'موظف آخر',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    employeeId = employee.id;
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
    otherEmployeeToken = await login(ctx.app, other.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('persists a plot-number edit and returns the latest values to the employee and the manager', async () => {
    const created = await createAs(employeeToken, {
      district: 'الفروانية',
      plotNumber: '970101',
    });
    expect(created.status).toBe('PENDING');
    expect(created.reference).toMatch(/^P-\d{6}$/);

    const edited = await patch(employeeToken, created.id, {
      version: created.version,
      plotNumber: '970102',
      block: '12',
      sizeSqm: '320.00',
    });
    expect(edited.status).toBe(200);
    const body = edited.body.data as {
      id: string;
      status: string;
      version: number;
      plotNumber: string | null;
      block: string | null;
      sizeSqm: string | null;
      reference: string;
      submissionReference: string;
      approvedReference: string | null;
    };
    expect(body.status).toBe('PENDING');
    expect(body.version).toBe(created.version + 1);
    expect(body.plotNumber).toBe('970102');
    expect(body.block).toBe('12');
    expect(body.sizeSqm).toBe('320');
    // The P code is permanent: editing never reissues it or creates an A code.
    expect(body.reference).toBe(created.reference);
    expect(body.submissionReference).toBe(created.reference);
    expect(body.approvedReference).toBeNull();

    // Re-reading after a reload shows the saved values for BOTH viewers.
    const ownReload = await get(employeeToken, created.id);
    expect(ownReload.status).toBe(200);
    expect(ownReload.body.data.plotNumber).toBe('970102');
    expect(ownReload.body.data.block).toBe('12');

    const managerReload = await get(managerToken, created.id);
    expect(managerReload.status).toBe(200);
    expect(managerReload.body.data.plotNumber).toBe('970102');
    expect(managerReload.body.data.block).toBe('12');
    expect(managerReload.body.data.status).toBe('PENDING');
    // The provisional owner survives the edit unchanged.
    expect(managerReload.body.data.proposedOwner?.name).toBe('Edit Owner');
  });

  it('notifies the managers once per successful edit with the required copy and details', async () => {
    const created = await createAs(employeeToken, {
      district: 'الجهراء',
      plotNumber: '970201',
    });
    const edited = await patch(employeeToken, created.id, {
      version: created.version,
      plotNumber: '970202',
    });
    expect(edited.status).toBe(200);

    const rows = await notificationsFor(created.id);
    const editRows = rows.filter(
      (row) => row.title === 'تم تعديل عقار تحت المراجعة',
    );
    expect(editRows).toHaveLength(1);
    const notification = editRows[0]!;
    expect(notification.userId).toBe(managerId);
    expect(notification.body).toContain(
      'قام الموظف بتحديث بيانات عقار بانتظار المراجعة. يُرجى الاطلاع على التعديلات.',
    );
    expect(notification.body).toContain(created.reference);
    expect(notification.body).toContain('موظف التعديل');
    expect(notification.body).toContain('التعديلات:');
    expect(notification.body).toContain('رقم القسيمة');
    expect(notification.body).toContain('التاريخ:');
    expect(notification.eventKey).toBe(
      `PROPERTY_EDITED:${created.id}:v${created.version + 1}`,
    );

    // The employee who saved the edit is never a recipient of the manager alert.
    expect(
      await ctx.prisma.notification.count({
        where: { propertyId: created.id, userId: employeeId },
      }),
    ).toBe(0);

    // The bell click opens the property in the Manager pending-review page.
    const dto = {
      propertyId: created.id,
      eventKey: notification.eventKey,
      clientId: null,
      contactId: null,
      contactType: null,
      clientReviewId: null,
      followUpSubjectId: null,
    };
    expect(notificationRoute(dto, 'MANAGER')?.path).toBe(
      `/manager/properties?property=${created.id}`,
    );
    expect(notificationAffectsPropertyLists({
      propertyId: created.id,
      type: 'SYSTEM',
    })).toBe(true);
  });

  it('does not notify for a no-op save or a failed save', async () => {
    const created = await createAs(employeeToken, {
      district: 'السالمية',
      plotNumber: '970301',
    });

    const noop = await patch(employeeToken, created.id, {
      version: created.version,
      plotNumber: '970301',
    });
    expect(noop.status).toBe(200);
    expect(
      await ctx.prisma.notification.count({
        where: {
          propertyId: created.id,
          title: 'تم تعديل عقار تحت المراجعة',
        },
      }),
    ).toBe(0);

    const stale = await patch(employeeToken, created.id, {
      version: created.version,
      plotNumber: '970399',
    });
    expect(stale.status).toBe(409);

    const forbidden = await patch(otherEmployeeToken, created.id, {
      version: created.version + 1,
      plotNumber: '970398',
    });
    expect(forbidden.status).toBe(403);

    expect(
      await ctx.prisma.notification.count({
        where: {
          propertyId: created.id,
          title: 'تم تعديل عقار تحت المراجعة',
        },
      }),
    ).toBe(0);
    const still = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(still.plotNumber).toBe('970301');
  });

  it('recalculates potential duplicates from the saved row, clears them on a distinct edit, and gates approval', async () => {
    // A manager-created AVAILABLE house with a matching owner, area and floors
    // but no block -> a plot match is POTENTIAL, not CONFIRMED.
    const candidate = await createAs(managerToken, {
      district: 'الأحمدي',
      plotNumber: '970401',
      block: null,
      sizeSqm: '300.00',
      floors: [{ type: 'GROUND', details: 'مجلس + ديوانية' }],
      newContact: { type: 'OWNER', name: 'Edit Owner', phone: '61110000' },
    });
    expect(candidate.status).toBe('AVAILABLE');

    const created = await createAs(employeeToken, {
      district: 'الأحمدي',
      plotNumber: '970402',
      block: '22',
    });
    expect((await latestApproval(created.id))?.duplicateCandidateIds).toBeNull();

    // The edit makes the plot match the candidate while the block still differs
    // (one side missing the block on the candidate): POTENTIAL.
    const edited = await patch(employeeToken, created.id, {
      version: created.version,
      plotNumber: '970401',
    });
    expect(edited.status).toBe(200);
    const afterEdit = await latestApproval(created.id);
    expect(afterEdit?.duplicateCandidateIds).toEqual([candidate.id]);

    // The Manager sees the candidate; the employee response never carries it.
    const managerView = await get(managerToken, created.id);
    expect(managerView.body.data.duplicateCandidateIds).toEqual([
      candidate.id,
    ]);
    expect(edited.body.data.duplicateCandidateIds ?? null).toBeNull();

    // Approval is blocked until the Manager explicitly reviews the match.
    const blocked = await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(blocked.status).toBe(400);

    // A genuinely different plot clears the candidate list.
    const distinct = await patch(employeeToken, created.id, {
      version: edited.body.data.version,
      plotNumber: '970499',
    });
    expect(distinct.status).toBe(200);
    expect(
      (await latestApproval(created.id))?.duplicateCandidateIds,
    ).toEqual([]);
  });

  it('keeps the recalculated candidates when the employee resubmits after a change request', async () => {
    const candidate = await createAs(managerToken, {
      district: 'حولي',
      plotNumber: '970501',
      block: null,
      sizeSqm: '300.00',
      floors: [{ type: 'GROUND', details: 'مجلس + ديوانية' }],
      newContact: { type: 'OWNER', name: 'Edit Owner', phone: '61110000' },
    });
    const created = await createAs(employeeToken, {
      district: 'حولي',
      plotNumber: '970502',
      block: '30',
    });

    // Manager requests changes (the property stays PENDING).
    const changes = await api()
      .post(`/properties/${created.id}/request-changes`)
      .set(auth(managerToken))
      .send({ reason: 'يرجى تعديل رقم القسيمة.', version: created.version });
    expect(changes.status).toBe(200);

    // The employee corrects the plot to the candidate's plot.
    const edited = await patch(employeeToken, created.id, {
      version: changes.body.data.version,
      plotNumber: '970501',
    });
    expect(edited.status).toBe(200);
    expect(
      (await latestApproval(created.id))?.duplicateCandidateIds,
    ).toEqual([candidate.id]);

    const resubmitted = await api()
      .post(`/properties/${created.id}/resubmit`)
      .set(auth(employeeToken))
      .send({});
    expect(resubmitted.status).toBe(200);
    const newRound = await latestApproval(created.id);
    expect(newRound?.status).toBe('PENDING');
    expect(newRound?.duplicateCandidateIds).toEqual([candidate.id]);
  });

  it('denies another employee editing the property and leaves it untouched', async () => {
    const created = await createAs(employeeToken, {
      district: 'الفنطاس',
      plotNumber: '970601',
    });
    const denied = await patch(otherEmployeeToken, created.id, {
      version: created.version,
      plotNumber: '970602',
    });
    expect(denied.status).toBe(403);

    const still = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(still.plotNumber).toBe('970601');
    expect(still.version).toBe(created.version);
    expect(
      await ctx.prisma.notification.count({
        where: {
          propertyId: created.id,
          title: 'تم تعديل عقار تحت المراجعة',
        },
      }),
    ).toBe(0);
  });
});
