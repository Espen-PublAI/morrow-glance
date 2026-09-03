import { describe, expect, it } from 'vitest';

import {
  authorizeConfigWrite,
  authorizeWebhook,
  canWriteConfiguration,
  isLocalRequest,
  secretsMatch,
} from '@/lib/morrow/server-auth';

const request = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe('secretsMatch', () => {
  it('matches only identical strings', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('abc', 'abcd')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});

describe('isLocalRequest', () => {
  it('recognises loopback hosts', () => {
    expect(isLocalRequest(request('http://localhost:3000/api/config'))).toBe(
      true,
    );
    expect(isLocalRequest(request('http://127.0.0.1/api/config'))).toBe(true);
    expect(isLocalRequest(request('http://[::1]:3000/api/config'))).toBe(true);
    expect(
      isLocalRequest(request('https://glance.example.com/api/config')),
    ).toBe(false);
  });
});

describe('authorizeConfigWrite', () => {
  it('allows localhost without a token in development only', () => {
    expect(authorizeConfigWrite(request('http://localhost:3000/'), {}).ok).toBe(
      true,
    );
    expect(
      authorizeConfigWrite(request('https://example.com/'), {}),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('refuses every write in production when no token is configured', () => {
    const env = { NODE_ENV: 'production' };
    // Even a forwarded Host: localhost must not unlock writes.
    expect(
      authorizeConfigWrite(request('http://localhost/'), env),
    ).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(
      authorizeConfigWrite(request('https://example.com/'), env),
    ).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it('requires the bearer token once configured, even on localhost', () => {
    const env = { MORROW_ADMIN_TOKEN: 'secret' };
    expect(
      authorizeConfigWrite(request('http://localhost:3000/'), env),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      authorizeConfigWrite(
        request('https://example.com/', { authorization: 'Bearer secret' }),
        env,
      ).ok,
    ).toBe(true);
    expect(
      canWriteConfiguration(
        request('https://example.com/', { authorization: 'Bearer nope' }),
        env,
      ),
    ).toBe(false);
  });
});

describe('authorizeWebhook', () => {
  it('is disabled without a token and accepts either header once configured', () => {
    expect(
      authorizeWebhook(request('https://x/api/webhooks/b1'), {}),
    ).toMatchObject({
      ok: false,
      status: 503,
    });
    const env = { MORROW_WEBHOOK_TOKEN: 'hook' };
    expect(
      authorizeWebhook(request('https://x/', { 'x-morrow-token': 'hook' }), env)
        .ok,
    ).toBe(true);
    expect(
      authorizeWebhook(
        request('https://x/', { authorization: 'Bearer hook' }),
        env,
      ).ok,
    ).toBe(true);
    expect(
      authorizeWebhook(
        request('https://x/', { authorization: 'Bearer nope' }),
        env,
      ),
    ).toMatchObject({ ok: false, status: 401 });
  });
});
