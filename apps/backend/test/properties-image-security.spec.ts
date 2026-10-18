import { Role } from '@arkan/shared';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
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
  textBytes,
  type TestContext,
} from './support/test-app';
import {
  animatedWebp,
  avifBytes,
  decompressionBombPng,
  gifBytes,
  isBlue,
  isRed,
  jpegExifPayload,
  jpegHasExif,
  jpegHasIptc,
  jpegHasXmp,
  jpegReencodingAboveStoredLimit,
  jpegWithGpsExif,
  listStoredFiles,
  mislabelledJpeg,
  orientedJpeg,
  parseExif,
  pngHasTextChunk,
  pngWithTextChunk,
  pngChunkTypes,
  pixelAt,
  rawPixels,
  readStoredBytes,
  riffChunkTypes,
  svgBytes,
  tiffBytes,
  truncatedJpeg,
  truncatedPng,
  webpWithExifAndXmp,
} from './support/image-fixtures';
import type { FileAsset } from '@prisma/client';

jest.setTimeout(180000);

const GPS_MARKER = 'ArkanTestCamera';
const PNG_TEXT_MARKER = 'secret-location';
const WEBP_XMP_MARKER = 'webp-xmp-secret';

describeWithDatabase('Property image privacy hardening (Phase 3B)', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    district: 'السالمية',
    block: '5',
    newContact: { type: 'OWNER', name: 'Owner', phone: '22221111' },
    ...overrides,
  });

  const upload = (
    token: string,
    buffer: Buffer,
    filename: string,
    overrides: Record<string, unknown> = {},
  ) => postProperty(ctx.app, token, payload(overrides), [{ buffer, filename }]);

  const storedAsset = async (
    propertyId: string,
  ): Promise<{ asset: FileAsset; bytes: Buffer }> => {
    const asset = await ctx.prisma.fileAsset.findFirst({
      where: { propertyId },
    });
    if (!asset) throw new Error('expected a FileAsset for the property');
    return { asset, bytes: await readStoredBytes(ctx.storageRoot, asset.key) };
  };

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

  // -------------------------------------------------------------------------
  // Sanitization of genuine metadata-bearing fixtures
  // -------------------------------------------------------------------------

  it('strips EXIF GPS metadata from a JPEG before it is persisted', async () => {
    const fixture = await jpegWithGpsExif();
    // Sanity: the fixture genuinely carries a GPS IFD.
    const fixtureExif = parseExif(jpegExifPayload(fixture));
    expect(fixtureExif.valid).toBe(true);
    expect(fixtureExif.hasGpsIfd).toBe(true);
    expect(fixtureExif.gpsTags.length).toBeGreaterThan(0);
    expect(jpegHasExif(fixture)).toBe(true);

    const response = await upload(managerToken, fixture, 'gps.jpg');
    expect(response.status).toBe(201);
    const { asset, bytes } = await storedAsset(response.body.data.id);

    // Stored bytes: no EXIF segment, no GPS structure, no marker string.
    expect(jpegHasExif(bytes)).toBe(false);
    expect(jpegExifPayload(bytes)).toBeUndefined();
    expect(parseExif(jpegExifPayload(bytes)).valid).toBe(false);
    expect(bytes.includes(GPS_MARKER)).toBe(false);

    // And the artifact still decodes as a clean JPEG.
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();

    expect(asset.mimeType).toBe('image/jpeg');
    expect(Number(asset.sizeBytes)).toBe(bytes.length);
  });

  it('applies EXIF orientation to the pixels and drops the orientation tag', async () => {
    const fixture = await orientedJpeg(6);
    const fixtureMeta = await sharp(fixture).metadata();
    expect(fixtureMeta.orientation).toBe(6);
    expect(fixtureMeta.width).toBe(40);
    expect(fixtureMeta.height).toBe(30);

    const response = await upload(managerToken, fixture, 'sideways.jpg');
    expect(response.status).toBe(201);
    const { bytes } = await storedAsset(response.body.data.id);

    // Orientation 6 must be baked into the pixels: 40x30 stored -> 30x40 displayed.
    const pixels = await rawPixels(bytes);
    expect(pixels.width).toBe(30);
    expect(pixels.height).toBe(40);
    const metadata = await sharp(bytes).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();

    // The red band (stored top rows) must end up on the right after a 90° CW turn.
    expect(isRed(pixelAt(pixels, pixels.width - 3, 20))).toBe(true);
    expect(isBlue(pixelAt(pixels, 2, 20))).toBe(true);
  });

  it('strips PNG textual metadata chunks', async () => {
    const fixture = await pngWithTextChunk();
    expect(pngHasTextChunk(fixture)).toBe(true);
    expect(pngChunkTypes(fixture)).toContain('tEXt');

    const response = await upload(managerToken, fixture, 'text.png');
    expect(response.status).toBe(201);
    const { asset, bytes } = await storedAsset(response.body.data.id);

    expect(pngHasTextChunk(bytes)).toBe(false);
    expect(pngChunkTypes(bytes)).not.toContain('tEXt');
    expect(pngChunkTypes(bytes)).not.toContain('zTXt');
    expect(pngChunkTypes(bytes)).not.toContain('iTXt');
    expect(bytes.includes(PNG_TEXT_MARKER)).toBe(false);

    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.exif).toBeUndefined();
    expect(asset.mimeType).toBe('image/png');
    expect(Number(asset.sizeBytes)).toBe(bytes.length);
  });

  it('strips WebP EXIF and XMP chunks', async () => {
    const fixture = await webpWithExifAndXmp();
    const fixtureChunks = riffChunkTypes(fixture);
    expect(fixtureChunks).toContain('EXIF');
    expect(fixtureChunks).toContain('XMP ');

    const response = await upload(managerToken, fixture, 'meta.webp');
    expect(response.status).toBe(201);
    const { asset, bytes } = await storedAsset(response.body.data.id);

    const chunks = riffChunkTypes(bytes);
    expect(chunks).not.toContain('EXIF');
    expect(chunks).not.toContain('XMP ');
    expect(bytes.includes(WEBP_XMP_MARKER)).toBe(false);

    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(asset.mimeType).toBe('image/webp');
    expect(Number(asset.sizeBytes)).toBe(bytes.length);
  });

  it('persists only sanitized bytes: no original upload survives anywhere', async () => {
    const fixture = await jpegWithGpsExif();
    const response = await upload(managerToken, fixture, 'gps2.jpg');
    expect(response.status).toBe(201);

    const files = await listStoredFiles(ctx.storageRoot);
    expect(files.length).toBeGreaterThan(0);
    let total = 0;
    for (const file of files) {
      const bytes = await readFile(file);
      total += bytes.length;
      // The original APP1/EXIF block and its maker/software strings are gone.
      expect(bytes.includes(GPS_MARKER)).toBe(false);
      expect(jpegHasExif(bytes)).toBe(false);
    }
    expect(total).toBeGreaterThan(0);
  });

  it('reports no residual EXIF/XMP/IPTC across every stored artifact', async () => {
    const response = await upload(managerToken, await jpegWithGpsExif(), 'scan.jpg');
    expect(response.status).toBe(201);
    const { bytes } = await storedAsset(response.body.data.id);
    expect(jpegHasExif(bytes)).toBe(false);
    expect(jpegHasXmp(bytes)).toBe(false);
    expect(jpegHasIptc(bytes)).toBe(false);
    const metadata = await sharp(bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Rejections
  // -------------------------------------------------------------------------

  it('rejects image bytes with a valid-looking signature but a corrupt body', async () => {
    for (const [buffer, filename] of [
      [truncatedJpeg(), 'broken.jpg'],
      [truncatedPng(), 'broken.png'],
      [await mislabelledJpeg(), 'polyglot.jpg'],
    ] as Array<[Buffer, string]>) {
      const response = await upload(employeeAToken, buffer, filename);
      expect(response.status).toBe(400);
    }
  });

  it('rejects unsupported image formats', async () => {
    for (const [buffer, filename] of [
      [await gifBytes(), 'x.gif'],
      [await tiffBytes(), 'x.tiff'],
      [svgBytes(), 'x.svg'],
      [await avifBytes(), 'x.avif'],
      [textBytes(), 'x.png'],
    ] as Array<[Buffer, string]>) {
      const response = await upload(employeeAToken, buffer, filename);
      expect(response.status).toBe(400);
    }
  });

  it('rejects an upload above the 5 MB limit with 413', async () => {
    const response = await upload(
      employeeAToken,
      pngBytes(5 * 1024 * 1024),
      'big.png',
    );
    expect(response.status).toBe(413);
  });

  it('rejects a decompression bomb (small upload, excessive decoded pixels) with 413', async () => {
    const bomb = await decompressionBombPng();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const response = await upload(employeeAToken, bomb, 'bomb.png');
    expect(response.status).toBe(413);
  });

  it('rejects animated / multipage input with 400', async () => {
    const fixture = await animatedWebp();
    expect((await sharp(fixture).metadata()).pages).toBeGreaterThan(1);
    const response = await upload(employeeAToken, fixture, 'anim.webp');
    expect(response.status).toBe(400);
  });

  it('rejects a sanitized artifact that exceeds the stored-size limit with 413', async () => {
    const fixture = await jpegReencodingAboveStoredLimit();
    expect(fixture.length).toBeLessThan(5 * 1024 * 1024);
    const response = await upload(employeeAToken, fixture, 'recompress.jpg');
    expect(response.status).toBe(413);
  });

  it('rolls back the property, contact and file when processing fails', async () => {
    const before = {
      properties: await ctx.prisma.property.count(),
      contacts: await ctx.prisma.contact.count(),
      assets: await ctx.prisma.fileAsset.count(),
      files: (await listStoredFiles(ctx.storageRoot)).length,
    };
    const response = await upload(
      employeeAToken,
      truncatedJpeg(),
      'broken.jpg',
      { newContact: { type: 'OWNER', name: 'Orphan Check', phone: '29998888' } },
    );
    expect(response.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(before.properties);
    expect(await ctx.prisma.contact.count()).toBe(before.contacts);
    expect(await ctx.prisma.fileAsset.count()).toBe(before.assets);
    expect((await listStoredFiles(ctx.storageRoot)).length).toBe(before.files);
  });

  // -------------------------------------------------------------------------
  // Authorization is unchanged
  // -------------------------------------------------------------------------

  it('keeps image authorization: creator/manager allowed, other employees blocked', async () => {
    const created = await upload(employeeAToken, await jpegWithGpsExif(), 'auth.jpg');
    expect(created.status).toBe(201);
    const url = `/properties/${created.body.data.id}/image`;

    expect((await api().get(url).set(auth(employeeBToken))).status).toBe(404);
    expect((await api().get(url).set(auth(employeeAToken))).status).toBe(200);
    expect((await api().get(url).set(auth(managerToken))).status).toBe(200);

    await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({});
    const afterApproval = await api().get(url).set(auth(employeeBToken));
    expect(afterApproval.status).toBe(200);
    expect(afterApproval.headers['content-type']).toBe('image/jpeg');
    expect(afterApproval.headers['cache-control']).toContain('private');
    expect(afterApproval.headers['x-content-type-options']).toBe('nosniff');
  });
});
