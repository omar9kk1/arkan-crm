import { resolveCorsOrigins } from '../src/config/cors-origins';

describe('CORS origin resolution', () => {
  it('keeps the configured production origin only in production', () => {
    expect(
      resolveCorsOrigins('https://crm.example.com', 'production'),
    ).toEqual(['https://crm.example.com']);
  });

  it('never widens production CORS with local development origins', () => {
    const origins = resolveCorsOrigins(
      'https://crm.example.com,https://admin.example.com',
      'production',
    );
    expect(origins).toEqual([
      'https://crm.example.com',
      'https://admin.example.com',
    ]);
    expect(origins).not.toContain('http://localhost:3000');
    expect(origins).not.toContain('http://192.168.1.8:3000');
  });

  it('keeps local development origins available outside production', () => {
    const origins = resolveCorsOrigins('http://localhost:3000', 'development');
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:3001');
    expect(origins).toContain('http://192.168.1.8:3000');
  });

  it('deduplicates and trims the configured list', () => {
    expect(
      resolveCorsOrigins(
        ' https://crm.example.com , https://crm.example.com ',
        'production',
      ),
    ).toEqual(['https://crm.example.com']);
  });
});
