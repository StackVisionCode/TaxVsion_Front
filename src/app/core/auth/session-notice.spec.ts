import { LOGIN_NOTICES, SESSION_EXPIRED_REASON, loginNoticeFor } from './session-notice';

describe('aviso de la pantalla de login', () => {
  it('explica la sesión expirada', () => {
    expect(loginNoticeFor(SESSION_EXPIRED_REASON)).toBe(LOGIN_NOTICES[SESSION_EXPIRED_REASON]);
  });

  it('no inventa un aviso para un motivo desconocido', () => {
    expect(loginNoticeFor('cualquier-cosa')).toBeNull();
    expect(loginNoticeFor(null)).toBeNull();
  });

  it('el copy va en inglés, como el resto de la pantalla', () => {
    for (const notice of Object.values(LOGIN_NOTICES)) {
      expect(notice).not.toMatch(/[áéíóúñ¿¡]/i);
    }
  });
});
