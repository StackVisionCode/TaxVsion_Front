import { AVATAR_PALETTE, avatarColorFor, initialsOf } from './avatar.util';

describe('avatar.util', () => {
  it('initialsOf: primera y última palabra en mayúscula', () => {
    expect(initialsOf('ana maría pérez')).toBe('AP');
    expect(initialsOf('  John   Doe ')).toBe('JD');
  });

  it('initialsOf: una sola palabra → 2 primeras letras', () => {
    expect(initialsOf('acme')).toBe('AC');
    expect(initialsOf('X')).toBe('X');
  });

  it('initialsOf: vacío → fallback', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf('   ', { fallback: 'NA' })).toBe('NA');
  });

  it('avatarColorFor es estable y pertenece a la paleta', () => {
    const a = avatarColorFor('user-123');
    expect(avatarColorFor('user-123')).toBe(a);
    expect(AVATAR_PALETTE).toContain(a);
    expect(AVATAR_PALETTE).toContain(avatarColorFor(''));
    expect(AVATAR_PALETTE).toContain(avatarColorFor(undefined));
  });

  it('avatarColorFor usa el mismo hash que chat/tasks (hash*31+c, uint32)', () => {
    // 'a' = 97 → 97 % 5 = 2
    expect(avatarColorFor('a')).toBe(AVATAR_PALETTE[2]);
  });
});
