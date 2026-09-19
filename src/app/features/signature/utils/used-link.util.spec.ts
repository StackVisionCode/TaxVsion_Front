import { markLinkUsed, readUsedLink } from './used-link.util';

describe('used-link util', () => {
  beforeEach(() => localStorage.clear());

  it('marca y lee el resultado por token', async () => {
    await markLinkUsed('token-abc', 'signed', new Date('2026-09-19T12:00:00Z'));
    expect(await readUsedLink('token-abc')).toEqual({ outcome: 'signed', atUtc: '2026-09-19T12:00:00.000Z' });
    expect(await readUsedLink('otro-token')).toBeNull();
  });

  it('nunca guarda el token en claro', async () => {
    await markLinkUsed('secret-token-123', 'declined');
    const stored = Object.keys(localStorage).join() + Object.values(localStorage).join();
    expect(stored).not.toContain('secret-token-123');
  });

  it('ignora valores corruptos', async () => {
    await markLinkUsed('t', 'signed');
    const key = Object.keys(localStorage)[0];
    localStorage.setItem(key, '{not json');
    expect(await readUsedLink('t')).toBeNull();
  });
});
