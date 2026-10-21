import { randomUUID } from 'node:crypto';
import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  pngBytes,
  postProperty,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
  generateVAPIDKeys: jest.fn(),
}));

import * as webpushModule from 'web-push';

const webpush = webpushModule as unknown as {
  sendNotification: jest.Mock;
  setVapidDetails: jest.Mock;
};

jest.setTimeout(120000);

// The VAPID identity is an environment secret; the test provides a harmless
// one so the feature is exercised without touching the real configuration.
process.env.PUSH_VAPID_PUBLIC_KEY = 'test-public-key';
process.env.PUSH_VAPID_PRIVATE_KEY = 'test-private-key';
process.env.PUSH_VAPID_SUBJECT = 'mailto:push-tests@arkan.test';

const DESKTOP_ENDPOINT = 'https://push.example.com/desktop-device';
const MOBILE_ENDPOINT = 'https://push.example.com/mobile-device';
const SHARED_ENDPOINT = 'https://push.example.com/shared-browser';

const keys = {
  p256dh: 'A'.repeat(87),
  auth: 'B'.repeat(22),
};

/**
 * Web Push for managers — the security-critical part of the feature.
 *
 * These tests drive the REAL application against the isolated test database:
 * the real session model (login, rotation, logout), the real subscription API
 * and the real dispatcher that reads the committed in-app notifications. Only
 * the network call to the push service is mocked.
 */
describeWithDatabase('Web Push (manager devices)', () => {
  let ctx: TestContext;
  const managerEmail = 'manager@push.local';
  const otherManagerEmail = 'manager.two@push.local';
  const employeeEmail = 'employee@push.local';

  const api = () => request(ctx.app.getHttpServer());

  /** The dispatcher, driven manually so the timing is deterministic. */
  const dispatch = async () => {
    const { PushDispatcherService } = await import(
      '../src/push/push-dispatcher.service'
    );
    const dispatcher = ctx.app.get(PushDispatcherService);
    await dispatcher.runOnce();
  };

  const loginAs = async (email: string) => {
    const response = await api()
      .post('/auth/login')
      .send({ email, password: 'ChangeMe123!' });
    expect(response.status).toBe(200);
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
    };
  };

  const subscribe = async (token: string, endpoint: string): Promise<number> => {
    const response = await api()
      .put('/push/subscriptions')
      .set(auth(token))
      .send({ endpoint, keys });
    return response.status;
  };

  const createClient = async (token: string) => {
    const response = await api()
      .post('/clients')
      .set(auth(token))
      .send({ name: 'زبون الدفع', phone: '65119999' });
    expect(response.status).toBe(201);
    return response.body.data as { id: string };
  };

  /** The endpoints that received a push in the last delivery pass. */
  const pushedEndpoints = (): string[] =>
    webpush.sendNotification.mock.calls.map(
      (call) => (call[0] as { endpoint: string }).endpoint,
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await createUser(ctx.prisma, {
      email: managerEmail,
      name: 'مدير الدفع',
      role: Role.MANAGER,
    });
    await createUser(ctx.prisma, {
      email: otherManagerEmail,
      name: 'مدير آخر',
      role: Role.MANAGER,
    });
    await createUser(ctx.prisma, {
      email: employeeEmail,
      name: 'موظف الدفع',
      role: Role.EMPLOYEE,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    webpush.sendNotification.mockClear();
    // Many logins in these tests: the auth rate limiter must not interfere.
    resetRateLimiting(ctx.app);
    // Every test starts from healthy accounts (a deactivation in one test
    // must not leak into the next).
    await ctx.prisma.user.updateMany({
      data: { role: 'MANAGER', isActive: true },
    });
    await ctx.prisma.user.updateMany({
      where: { email: employeeEmail },
      data: { role: 'EMPLOYEE' },
    });
    await ctx.prisma.notification.deleteMany({});
    await ctx.prisma.pushSubscription.deleteMany({});
  });

  it('pushes to a desktop AND a mobile session of the same manager at once', async () => {
    const desktop = await loginAs(managerEmail);
    const mobile = await loginAs(managerEmail);
    expect(desktop.accessToken).not.toBe(mobile.accessToken);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    expect(await subscribe(mobile.accessToken, MOBILE_ENDPOINT)).toBe(200);

    const employee = await loginAs(employeeEmail);
    const client = await createClient(employee.accessToken);
    await dispatch();

    expect(pushedEndpoints().sort()).toEqual(
      [DESKTOP_ENDPOINT, MOBILE_ENDPOINT].sort(),
    );
    const payload = JSON.parse(
      webpush.sendNotification.mock.calls[0]?.[1] as string,
    ) as { title: string; body: string; url: string };
    expect(payload.title).toBe('عميل جديد');
    expect(payload.body).toContain('موظف الدفع');
    expect(payload.url).toBe(`/manager/clients?client=${client.id}`);
    // No private client data ever travels in a push preview.
    expect(JSON.stringify(payload)).not.toContain('65119999');
    expect(JSON.stringify(payload)).not.toContain('زبون الدفع');
  });

  it('keeps delivering after several refresh rotations of the same device', async () => {
    const desktop = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);

    let accessToken = desktop.accessToken;
    let refreshToken = desktop.refreshToken;
    for (let rotation = 0; rotation < 3; rotation += 1) {
      const refreshed = await api()
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(refreshed.status).toBe(200);
      accessToken = (refreshed.body.data as { accessToken: string }).accessToken;
      refreshToken = (refreshed.body.data as { refreshToken: string })
        .refreshToken;
    }

    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();

    expect(pushedEndpoints()).toEqual([DESKTOP_ENDPOINT]);
    // The rotated session is still a valid, working session.
    expect((await api().get('/auth/me').set(auth(accessToken))).status).toBe(200);
  });

  it('stops the desktop pushes on logout while the mobile device keeps receiving', async () => {
    const desktop = await loginAs(managerEmail);
    const mobile = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    expect(await subscribe(mobile.accessToken, MOBILE_ENDPOINT)).toBe(200);

    const loggedOut = await api()
      .post('/auth/logout')
      .send({ refreshToken: desktop.refreshToken });
    expect(loggedOut.status).toBe(200);

    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();

    // Only the still-signed-in device is pushed to.
    expect(pushedEndpoints()).toEqual([MOBILE_ENDPOINT]);
    // The signed-out device's subscription is gone for good.
    expect(
      await ctx.prisma.pushSubscription.count({
        where: { endpoint: DESKTOP_ENDPOINT },
      }),
    ).toBe(0);
    // And the other device's session is untouched.
    expect(
      await ctx.prisma.refreshToken.count({
        where: { lineageId: { not: null }, revokedAt: null },
      }),
    ).toBeGreaterThan(0);
  });

  it('never resurrects a signed-out session through a racing refresh', async () => {
    const desktop = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);

    // Log out first, then try to rotate the revoked token.
    await api()
      .post('/auth/logout')
      .send({ refreshToken: desktop.refreshToken });
    const racing = await api()
      .post('/auth/refresh')
      .send({ refreshToken: desktop.refreshToken });
    expect(racing.status).toBe(401);

    // The lineage has no live session left, so no push can be delivered.
    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();
    expect(pushedEndpoints()).toEqual([]);
    expect(
      await ctx.prisma.pushSubscription.count({
        where: { endpoint: DESKTOP_ENDPOINT },
      }),
    ).toBe(0);
  });

  it('stops pushing when the manager account is deactivated or demoted', async () => {
    const desktop = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    const manager = await ctx.prisma.user.findUnique({
      where: { email: managerEmail },
    });

    // Demoted to an employee: the record-activity feed is a manager feed.
    await ctx.prisma.user.update({
      where: { id: manager?.id as string },
      data: { role: 'EMPLOYEE' },
    });
    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();
    expect(pushedEndpoints()).toEqual([]);

    // A deactivated account receives nothing either, while a healthy manager
    // on another device still does.
    await ctx.prisma.user.update({
      where: { id: manager?.id as string },
      data: { role: 'MANAGER', isActive: false },
    });
    await ctx.prisma.notification.deleteMany({});
    webpush.sendNotification.mockClear();
    const other = await loginAs(otherManagerEmail);
    expect(await subscribe(other.accessToken, MOBILE_ENDPOINT)).toBe(200);
    await createClient(employee.accessToken);
    await dispatch();
    expect(pushedEndpoints()).not.toContain(DESKTOP_ENDPOINT);
    expect(pushedEndpoints()).toContain(MOBILE_ENDPOINT);
  });

  it('never leaks a notification across accounts sharing one browser', async () => {
    const first = await loginAs(managerEmail);
    expect(await subscribe(first.accessToken, SHARED_ENDPOINT)).toBe(200);

    // The same browser now signs in with ANOTHER account: the endpoint's owner
    // changes and the first account's row is gone.
    const second = await loginAs(otherManagerEmail);
    expect(await subscribe(second.accessToken, SHARED_ENDPOINT)).toBe(200);
    const rows = await ctx.prisma.pushSubscription.findMany({
      where: { endpoint: SHARED_ENDPOINT },
    });
    expect(rows).toHaveLength(1);
    const other = await ctx.prisma.user.findUnique({
      where: { email: otherManagerEmail },
    });
    expect(rows[0]?.userId).toBe(other?.id);

    // The event is delivered ONCE to the shared endpoint (not once per
    // account that ever used it).
    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();
    expect(
      pushedEndpoints().filter((endpoint) => endpoint === SHARED_ENDPOINT),
    ).toHaveLength(1);
  });

  it('delivers nothing to a subscription that was switched off', async () => {
    const desktop = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);

    const removed = await api()
      .delete('/push/subscriptions')
      .set(auth(desktop.accessToken))
      .send({ endpoint: DESKTOP_ENDPOINT });
    expect(removed.status).toBe(200);
    expect(
      await ctx.prisma.pushSubscription.count({
        where: { endpoint: DESKTOP_ENDPOINT },
      }),
    ).toBe(0);

    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();
    expect(pushedEndpoints()).toEqual([]);
  });

  it('refuses a subscription from a session without a lineage and never pushes to it', async () => {
    const desktop = await loginAs(managerEmail);
    // A session created before the lineage existed: its row has no lineage.
    await ctx.prisma.refreshToken.updateMany({ data: { lineageId: null } });
    const refused = await subscribe(desktop.accessToken, DESKTOP_ENDPOINT);
    expect(refused).toBe(409);
    expect(
      await ctx.prisma.pushSubscription.count({
        where: { endpoint: DESKTOP_ENDPOINT },
      }),
    ).toBe(0);
  });

  it('keeps the ordinary login, refresh and logout flows working', async () => {
    const session = await loginAs(managerEmail);
    expect(session.accessToken).toEqual(expect.any(String));

    const me = await api().get('/auth/me').set(auth(session.accessToken));
    expect(me.status).toBe(200);

    const refreshed = await api()
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);

    // The OLD refresh token is single-use.
    const replay = await api()
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);

    const logout = await api()
      .post('/auth/logout')
      .send({
        refreshToken: (refreshed.body.data as { refreshToken: string })
          .refreshToken,
      });
    expect(logout.status).toBe(200);

    // And the access token of the revoked session no longer works.
    const after = await api()
      .get('/auth/me')
      .set(auth((refreshed.body.data as { accessToken: string }).accessToken));
    expect(after.status).toBe(401);
  });

  it('re-binds one browser opt-in to a new session without duplicating it', async () => {
    // The browser keeps its opt-in across a re-login (the session lives in
    // sessionStorage, so a restart means a new login). Re-subscribing the same
    // endpoint must move the binding, not duplicate it.
    const first = await loginAs(managerEmail);
    expect(await subscribe(first.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    const second = await loginAs(managerEmail);
    expect(await subscribe(second.accessToken, DESKTOP_ENDPOINT)).toBe(200);

    const rows = await ctx.prisma.pushSubscription.findMany({
      where: { endpoint: DESKTOP_ENDPOINT },
    });
    expect(rows).toHaveLength(1);
    const manager = await ctx.prisma.user.findUnique({
      where: { email: managerEmail },
    });
    const currentSession = await ctx.prisma.refreshToken.findFirst({
      where: { userId: manager?.id as string, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(rows[0]?.lineageId).toBe(currentSession?.lineageId);

    // And the re-bound device keeps receiving pushes.
    const employee = await loginAs(employeeEmail);
    await createClient(employee.accessToken);
    await dispatch();
    expect(pushedEndpoints()).toEqual([DESKTOP_ENDPOINT]);
  });

  it('rejects a push subscription from an employee account', async () => {
    const employee = await loginAs(employeeEmail);
    expect(await subscribe(employee.accessToken, DESKTOP_ENDPOINT)).toBe(403);
  });

  it('pushes exactly the change text the manager sees in the bell', async () => {
    const manager = await loginAs(managerEmail);
    const employee = await loginAs(employeeEmail);
    expect(await subscribe(manager.accessToken, DESKTOP_ENDPOINT)).toBe(200);

    // The employee creates a property, the manager approves it, then the
    // employee edits the approved price and sends it back for review.
    const created = await postProperty(
      ctx.app,
      employee.accessToken,
      {
        listingType: 'SALE',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: '12',
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description: 'بيت للبيع',
        floors: [{ type: 'GROUND', details: 'صالة' }],
        newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
      },
      [{ buffer: pngBytes(), filename: 'photo.png' }],
    );
    expect(created.status).toBe(201);
    const propertyId = (created.body.data as { id: string }).id;
    expect(
      (
        await api()
          .post(`/properties/${propertyId}/approve`)
          .set(auth(manager.accessToken))
          .send({})
      ).status,
    ).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: propertyId },
      select: { version: true },
    });
    await ctx.prisma.notification.deleteMany({});
    expect(
      (
        await api()
          .patch(`/properties/${propertyId}`)
          .set(auth(employee.accessToken))
          .send({ version: approved?.version, askingPrice: '300000.00' })
      ).status,
    ).toBe(200);

    const row = (
      await ctx.prisma.notification.findMany({
        where: { type: 'PROPERTY_RESUBMITTED' },
      })
    )[0];
    expect(row?.title).toBe('عقار مُعدّل بانتظار موافقتك');
    expect(row?.body).toContain('السعر');

    await dispatch();
    const payload = JSON.parse(
      webpush.sendNotification.mock.calls[0]?.[1] as string,
    ) as { title: string; body: string; url: string };
    // The push preview and the in-app row carry the SAME text.
    expect(payload.title).toBe(row?.title);
    expect(payload.body).toBe(row?.body);
    expect(payload.body).toContain('300,000');
    expect(payload.body).not.toContain('66661111');
    // And it opens the exact property.
    expect(payload.url).toBe(
      `/manager/properties?property=${encodeURIComponent(propertyId)}`,
    );
  });

  it('sends a test message to the caller own device only', async () => {
    const desktop = await loginAs(managerEmail);
    const mobile = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    expect(await subscribe(mobile.accessToken, MOBILE_ENDPOINT)).toBe(200);

    const response = await api().post('/push/test').set(auth(desktop.accessToken));
    expect(response.status).toBe(200);
    // Only the calling session's own device is addressed.
    expect((response.body.data as { sent: number }).sent).toBe(1);
    expect(pushedEndpoints()).toEqual([DESKTOP_ENDPOINT]);
    // The test message creates no in-app notification row.
    expect(await ctx.prisma.notification.count()).toBe(0);

    const employee = await loginAs(employeeEmail);
    expect((await api().post('/push/test').set(auth(employee.accessToken))).status).toBe(403);
  });

  it('never removes another device’s subscription', async () => {
    const desktop = await loginAs(managerEmail);
    const mobile = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    expect(await subscribe(mobile.accessToken, MOBILE_ENDPOINT)).toBe(200);

    // Switching the desktop device off must not touch the mobile device.
    const removed = await api()
      .delete('/push/subscriptions')
      .set(auth(desktop.accessToken))
      .send({ endpoint: DESKTOP_ENDPOINT });
    expect(removed.status).toBe(200);
    expect(
      await ctx.prisma.pushSubscription.count({
        where: { endpoint: MOBILE_ENDPOINT },
      }),
    ).toBe(1);
  });

  it('ignores an unknown subscription endpoint on delete', async () => {
    const desktop = await loginAs(managerEmail);
    expect(await subscribe(desktop.accessToken, DESKTOP_ENDPOINT)).toBe(200);
    const removed = await api()
      .delete('/push/subscriptions')
      .set(auth(desktop.accessToken))
      .send({ endpoint: `https://push.example.com/${randomUUID()}` });
    expect(removed.status).toBe(200);
    expect(
      await ctx.prisma.pushSubscription.count({
        where: { endpoint: DESKTOP_ENDPOINT },
      }),
    ).toBe(1);
  });
});
