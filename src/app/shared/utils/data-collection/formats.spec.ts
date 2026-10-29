import { describe, expect, it } from 'vitest';
import { isHttpsUri } from './formats';

const backslash = String.fromCharCode(92);

// Resultados medidos con Uri.TryCreate(value, UriKind.Absolute) && Scheme == "https" en .NET 10.
describe('isHttpsUri (Uri.TryCreate parity)', () => {
  it.each([
    'https://example.com',
    'HTTPS://EXAMPLE.COM',
    ' https://example.com ',
    '\thttps://example.com\n',
    `https:${backslash}${backslash}example.com`,
    'https://user:pass@host.com',
    'https://example.com:',
    'https://example.com:080',
    'https://[::1]:443',
    'https://[fe80::1%25eth0]',
    'https://1.2.3.4.5',
    'https://256.1.1.1',
    'https://ex_ample.com',
    'https://例え.jp',
    'https://exa　mple.com',
    'https://example.com/a b',
    `https://example.com/${backslash}x`,
    'https://example.com/%zz',
    `https://${'a'.repeat(100)}.com`,
    `https://${'a'.repeat(252)}.com`,
  ])('accepts %j', (value) => {
    expect(isHttpsUri(value)).toBe(true);
  });

  it.each([
    'https:example.com',
    'https:/example.com',
    'https:///example.com',
    `https:${backslash}example.com`,
    `https://x.com${backslash}path`,
    'https://exa\nmple.com',
    '\u0001https://example.com',
    'https://a.com\u0000',
    'https://%41.com',
    'https://a..b',
    'https://.example.com',
    'https://a@b@c.com',
    'https://a!b.com',
    'https://a+b.com',
    'https://*.com',
    'https://a\u0085b.com',
    'https://x.com:65536',
    'https://[::g]',
    'https://',
    'http://example.com',
    'javascript:alert(1)',
    `https://${'a'.repeat(253)}.com`,
  ])('rejects %j', (value) => {
    expect(isHttpsUri(value)).toBe(false);
  });
});
