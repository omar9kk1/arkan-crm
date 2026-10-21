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

/**
 * The revision history of repeated review rounds.
 *
 * The database allows only ONE PENDING revision per property (a partial unique
 * index). A review round therefore REUSES the open revision row while it is
 * open, CLOSES it on the manager's decision — the approving row becomes the
 * round's approved record — and a later cycle opens a fresh one. Any other
 * order would fail a second edit/approval cycle with a unique-constraint
 * error, which is exactly the bug this suite pins down.
 */
describeWithDatabase('Property revision lifecycle', () => {
  let ctx: TestContext;
  let managerToken: string;
  let creatorToken: string;

  const api = () => request(ctx.app.getHttpServer());

  const revisions = async (id: string) =>
    ctx.prisma.propertyRevision.findMany({
      where: { propertyId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, payload: true, reviewedById: true },
    });

  const openPendingCount = async (id: string) =>
    ctx.prisma.propertyRevision.count({
      where: { propertyId: id, status: 'PENDING' },
    });

  const createApprovedProperty = async () => {
    const created = await postProperty(
      ctx.app,
      creatorToken,
      {
        listingType: 'SALE',
        governorate: 'العاصمة',
        district: 'السالمية',
        block: '1',
        plotNumber: '10',
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description: 'بيت للبيع',
        floors: [{ type: 'GROUND', details: 'صالة' }],
        newContact: { type: 'OWNER', name: 'مالك', phone: '77001001' },
      },
      image,
    );
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({})).status).toBe(200);
    return (await api().get(`/properties/${id}`).set(auth(creatorToken))).body.data as {
      id: string;
      version: number;
    };
  };

  const edit = (id: string, version: number, changes: Record<string, unknown>) =>
    api()
      .patch(`/properties/${id}`)
      .set(auth(creatorToken))
      .send({ version, ...changes });

  const approve = (id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

  const reject = (id: string, reason: string) =>
    api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason });

  const requestChanges = (id: string, reason: string) =>
    api()
      .post(`/properties/${id}/request-changes`)
      .set(auth(managerToken))
      .send({ reason });

  const resubmit = (id: string) =>
    api().post(`/properties/${id}/resubmit`).set(auth(creatorToken)).send({});

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@lifecycle.local',
      name: 'Manager Lifecycle',
      role: Role.MANAGER,
    });
    const creator = await createUser(ctx.prisma, {
      email: 'creator@lifecycle.local',
      name: 'Creator Lifecycle',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    creatorToken = await login(ctx.app, creator.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('runs three edit/approval cycles without a unique-constraint error, one row per round', async () => {
    const property = await createApprovedProperty();

    // Round 1: first edit of the APPROVED property opens its first revision
    // (on top of the creation-approval record).
    const round1 = await edit(property.id, property.version, {
      askingPrice: '300000.00',
    });
    expect(round1.status).toBe(200);
    expect(await openPendingCount(property.id)).toBe(1);
    expect((await revisions(property.id)).length).toBe(2);

    expect((await approve(property.id)).status).toBe(200);
    // The round is CLOSED: its row became the approved record.
    expect(await openPendingCount(property.id)).toBe(0);
    let rows = await revisions(property.id);
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.status === 'APPROVED')).toBe(true);
    expect(rows[rows.length - 1]?.reviewedById).not.toBeNull();

    // Round 2: a second cycle must NOT hit the unique constraint.
    const afterRound1 = (
      await api().get(`/properties/${property.id}`).set(auth(creatorToken))
    ).body.data as { version: number };
    const round2 = await edit(property.id, afterRound1.version, {
      askingPrice: '350000.00',
    });
    expect(round2.status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);

    // Round 3: a third cycle, same guarantee.
    const afterRound2 = (
      await api().get(`/properties/${property.id}`).set(auth(creatorToken))
    ).body.data as { version: number };
    const round3 = await edit(property.id, afterRound2.version, {
      plotNumber: '22',
    });
    expect(round3.status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);

    rows = await revisions(property.id);
    expect(rows.length).toBe(4);
    expect(rows.every((row) => row.status === 'APPROVED')).toBe(true);
    expect(await openPendingCount(property.id)).toBe(0);
  });

  it('reports exactly the CURRENT round change (no re-report of earlier rounds)', async () => {
    const property = await createApprovedProperty();

    const round1 = await edit(property.id, property.version, {
      askingPrice: '300000.00',
    });
    expect(round1.status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);

    const afterRound1 = (
      await api().get(`/properties/${property.id}`).set(auth(creatorToken))
    ).body.data as { version: number };
    const round2 = await edit(property.id, afterRound1.version, {
      askingPrice: '340000.00',
      plotNumber: '31',
    });
    expect(round2.status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);

    const detail = (
      await api()
        .get(`/notifications?limit=50`)
        .set(auth(creatorToken))
    ).body.data as { items: { type: string; message: string }[] };
    const approvedNotices = detail.items.filter(
      (item) => item.type === 'PROPERTY_APPROVED',
    );
    // The two rounds each reported their OWN change — the list is newest
    // first, so the newest approved notice is the SECOND round's, which never
    // repeats the first round's 250k ← 300k move.
    expect(approvedNotices.length).toBeGreaterThanOrEqual(2);
    const lastApproved = approvedNotices[0]?.message ?? '';
    expect(lastApproved).toContain('رقم القسيمة (10 ← 31)');
    expect(lastApproved).toContain('السعر (300,000 ← 340,000');
    expect(lastApproved).not.toContain('250,000');
    // And the FIRST round's notice is the earlier one, with its own move.
    const firstRoundNotice = approvedNotices[1]?.message ?? '';
    expect(firstRoundNotice).toContain('السعر (250,000 ← 300,000');
  });

  it('recovers after REJECTED: the closed round lets a fresh cycle open, and the diff baseline is the last approved state', async () => {
    const property = await createApprovedProperty();

    const opened = await edit(property.id, property.version, {
      askingPrice: '400000.00',
    });
    expect(opened.status).toBe(200);
    expect((await reject(property.id, 'السعر غير منطقي')).status).toBe(200);
    // The rejected round left NO open revision behind (the row stays as
    // history with the REJECTED status).
    const rows = await revisions(property.id);
    expect(rows.length).toBe(2);
    expect(rows[rows.length - 1]?.status).toBe('REJECTED');
    expect(await openPendingCount(property.id)).toBe(0);

    // The creator corrects and resubmits; approval succeeds and its baseline
    // is the last APPROVED state (250k → 401k in one verified round).
    const resubmitted = await resubmit(property.id);
    expect(resubmitted.status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);

    const after = await revisions(property.id);
    expect(after.length).toBe(3);
    expect(after[after.length - 1]?.status).toBe('APPROVED');
    expect(await openPendingCount(property.id)).toBe(0);
  });

  it('keeps exactly one carrier row across CHANGES_REQUESTED and closes it at the approval', async () => {
    const property = await createApprovedProperty();

    const opened = await edit(property.id, property.version, {
      title: 'بيت مطلوب تعديله',
    });
    expect(opened.status).toBe(200);
    expect((await requestChanges(property.id, 'عدّل العنوان')).status).toBe(200);
    // Requesting changes does NOT close the round nor open a second one.
    expect(await openPendingCount(property.id)).toBe(1);

    expect((await resubmit(property.id)).status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);
    const rows = await revisions(property.id);
    expect(rows.length).toBe(2);
    expect(await openPendingCount(property.id)).toBe(0);
  });

  it('keeps image retention rules across cycles: replacement applies once, later cycles keep it', async () => {
    const property = await createApprovedProperty();
    const before = (
      await ctx.prisma.property.findUnique({
        where: { id: property.id },
        select: { primaryImageId: true },
      })
    )?.primaryImageId as string;
    const assetsBefore = await ctx.prisma.fileAsset.count({
      where: { propertyId: property.id },
    });

    // Cycle 1 replaces the image together with a price edit.
    const round1 = await api()
      .patch(`/properties/${property.id}`)
      .set(auth(creatorToken))
      .field('version', String(property.version))
      .field(
        'payload',
        JSON.stringify({ version: property.version, askingPrice: '500000.00' }),
      )
      .attach('image', pngBytes(), 'replacement.png');
    expect(round1.status).toBe(200);
    // Not public before the approval.
    expect(
      (
        await ctx.prisma.property.findUnique({
          where: { id: property.id },
          select: { primaryImageId: true },
        })
      )?.primaryImageId,
    ).toBe(before);
    expect((await approve(property.id)).status).toBe(200);
    const replaced = (
      await ctx.prisma.property.findUnique({
        where: { id: property.id },
        select: { primaryImageId: true },
      })
    )?.primaryImageId as string;
    expect(replaced).not.toBe(before);
    expect(replaced).not.toBeNull();
    // The ORIGINAL image row survives (never physically deleted).
    expect(
      await ctx.prisma.fileAsset.findUnique({ where: { id: before } }),
    ).not.toBeNull();

    // Cycle 2 has NO image at all: the approved image must survive untouched.
    const afterRound1 = (
      await api().get(`/properties/${property.id}`).set(auth(creatorToken))
    ).body.data as { version: number };
    const round2 = await edit(property.id, afterRound1.version, {
      district: 'السالمية',
    });
    expect(round2.status).toBe(200);
    expect((await approve(property.id)).status).toBe(200);
    expect(
      (
        await ctx.prisma.property.findUnique({
          where: { id: property.id },
          select: { primaryImageId: true },
        })
      )?.primaryImageId,
    ).toBe(replaced);

    // Exactly one asset per stored image: no leak, no orphan across rounds.
    expect(
      await ctx.prisma.fileAsset.count({ where: { propertyId: property.id } }),
    ).toBe(assetsBefore + 1);
  });

  it('rolls back a failed submission and leaves revision state untouched (idempotent retry)', async () => {
    const property = await createApprovedProperty();
    const assetsBefore = await ctx.prisma.fileAsset.count({
      where: { propertyId: property.id },
    });

    // A real round opens first.
    const opened = await edit(property.id, property.version, {
      askingPrice: '600000.00',
    });
    expect(opened.status).toBe(200);
    const rowsAfterOpen = await revisions(property.id);
    expect(await openPendingCount(property.id)).toBe(1);

    // A DUPLICATE of the same edit — same, already-burned version — is a
    // stale submission: it is refused with 409 AND it carries an image, so
    // its failed transaction must also leave no stored file behind.
    const duplicate = await api()
      .patch(`/properties/${property.id}`)
      .set(auth(creatorToken))
      .field('version', String(property.version))
      .field('payload', JSON.stringify({ version: property.version }))
      .attach('image', pngBytes(), 'retry.png');
    expect(duplicate.status).toBe(409);
    expect(await revisions(property.id)).toEqual(rowsAfterOpen);
    expect(
      await ctx.prisma.fileAsset.count({ where: { propertyId: property.id } }),
    ).toBe(assetsBefore);

    // The retry with the FRESH version succeeds and REUSES the open round's
    // row (no second PENDING row, no unique-constraint failure).
    const fresh = (
      await api().get(`/properties/${property.id}`).set(auth(creatorToken))
    ).body.data as { version: number };
    const retry = await edit(property.id, fresh.version, {
      askingPrice: '700000.00',
    });
    expect(retry.status).toBe(200);
    expect(await openPendingCount(property.id)).toBe(1);
    expect((await revisions(property.id)).length).toBe(rowsAfterOpen.length);
  });
});
