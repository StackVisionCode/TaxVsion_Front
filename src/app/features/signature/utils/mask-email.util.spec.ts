import { maskEmail } from './mask-email.util';

describe('maskEmail', () => {
  it('deja la inicial y el dominio, con puntos de largo fijo', () => {
    expect(maskEmail('juan.perez@gmail.com')).toBe('j•••••@gmail.com');
    expect(maskEmail('ab@acme.io')).toBe('a•••••@acme.io');
  });

  it('una parte local de una sola letra no se revela', () => {
    expect(maskEmail('j@acme.io')).toBe('•••••@acme.io');
  });

  it('valores vacíos o sin @ quedan totalmente ocultos', () => {
    expect(maskEmail('')).toBe('•••••');
    expect(maskEmail(null)).toBe('•••••');
    expect(maskEmail('not-an-email')).toBe('•••••');
    expect(maskEmail('juan@')).toBe('•••••');
  });
});
