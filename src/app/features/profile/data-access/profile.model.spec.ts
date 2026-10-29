import { describe, expect, it } from 'vitest';
import { daysUntil, isValidPhoneNumber, passwordStrength, roleDisplayName, sessionLocationLabel } from './profile.model';

describe('profile.model · teléfono', () => {
  it('acepta 7-20 caracteres de dígitos, +, - y espacios (tras trim)', () => {
    expect(isValidPhoneNumber('+1 202-555-0112')).toBe(true);
    expect(isValidPhoneNumber('  5550112  ')).toBe(true);
    expect(isValidPhoneNumber('12345678901234567890')).toBe(true);
  });

  it('rechaza cortos, largos y caracteres fuera de la regla del backend', () => {
    expect(isValidPhoneNumber('555011')).toBe(false);
    expect(isValidPhoneNumber('123456789012345678901')).toBe(false);
    expect(isValidPhoneNumber('(202) 555-0112')).toBe(false);
    expect(isValidPhoneNumber('202.555.0112')).toBe(false);
    expect(isValidPhoneNumber('   ')).toBe(false);
  });
});

describe('profile.model · presentación', () => {
  it('traduce el actorType a un rol que se entiende', () => {
    expect(roleDisplayName('TenantAdmin')).toBe('Office admin');
    expect(roleDisplayName('TenantEmployee')).toBe('Team member');
    expect(roleDisplayName(null)).toBe('Member');
  });

  it('una contraseña bajo el mínimo del backend es "too short" aunque sea variada', () => {
    expect(passwordStrength('Ab1!Ab1!')).toBe(0);
  });

  it('la fuerza sube con largo y variedad', () => {
    expect(passwordStrength('aaaaaaaaaaaa')).toBe(1);
    expect(passwordStrength('aaaaaaaaaaaaaaaa')).toBe(2);
    expect(passwordStrength('Aaaaaaaaaaaaaaaa')).toBe(3);
    expect(passwordStrength('Aaaaaaaaaaaaaa1!')).toBe(4);
  });

  it('las IP de loopback se muestran como este equipo', () => {
    expect(sessionLocationLabel('::1')).toBe('This computer');
    expect(sessionLocationLabel('127.0.0.1')).toBe('This computer');
    expect(sessionLocationLabel('203.0.113.7')).toBe('203.0.113.7');
    expect(sessionLocationLabel(null)).toBeNull();
  });

  it('cuenta los días que faltan, aunque la fecha venga sin zona', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(daysUntil('2026-10-26T12:00:00', now)).toBe(6);
    expect(daysUntil('2026-10-20T18:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-10-19T12:00:00Z', now)).toBe(-1);
  });
});
