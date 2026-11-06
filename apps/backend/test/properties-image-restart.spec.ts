import { Role } from '@arkan/shared';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  pngBytes,
  postProperty,
  resetDatabase,
} from './support/test-app';

jest.setTimeout(120000);

describeWithDatabase('Property image durability across application restart', () => {
  it('serves the identical stored image after the application is rebuilt', async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'arkan-restart-'));
    const first = await createTestApp({ storageRoot });
    await resetDatabase(first.prisma);
    const manager = await createUser(first.prisma, {
      email: 'restart.manager@test.local',
      name: 'Restart Manager',
      role: Role.MANAGER,
    });
    const token = await login(first.app, manager.email);
    const created = await postProperty(
      first.app,
      token,
      {
        listingType: 'SALE',
        district: 'الفنطاس',
        block: '7',
        plotNumber: '4242',
        newContact: { type: 'OWNER', name: 'Owner', phone: '22223333' },
      },
      [{ buffer: pngBytes(2048), filename: 'photo.png' }],
    );
    expect(created.status).toBe(201);
    const url = created.body.data.primaryImageUrl as string;

    const before = await request(first.app.getHttpServer())
      .get(url)
      .set(auth(token));
    expect(before.status).toBe(200);
    const length = Number(before.headers['content-length']);
    expect(length).toBeGreaterThan(0);
    await first.close();

    // A brand-new application instance (fresh Nest process) must still find the
    // bytes on disk through the same FileAsset row.
    const second = await createTestApp({ storageRoot });
    const token2 = await login(second.app, manager.email);
    const after = await request(second.app.getHttpServer())
      .get(url)
      .set(auth(token2));
    expect(after.status).toBe(200);
    expect(Number(after.headers['content-length'])).toBe(length);
    await second.close();
  });
});
