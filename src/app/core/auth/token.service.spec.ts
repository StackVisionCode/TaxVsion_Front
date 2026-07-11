import { TestBed } from '@angular/core/testing';
import { TokenService } from './token.service';
import { AuthTokens } from './auth.model';

describe('TokenService', () => {
  let service: TokenService;

  const tokens: AuthTokens = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresInSeconds: 900,
    deviceToken: 'device-1',
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [TokenService] });
    service = TestBed.inject(TokenService);
  });

  afterEach(() => localStorage.clear());

  it('parte sin sesión', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
  });

  it('persiste la sesión y queda autenticado', () => {
    service.setSession(tokens);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.getAccessToken()).toBe('access-1');
    expect(service.getRefreshToken()).toBe('refresh-1');
    expect(service.getDeviceToken()).toBe('device-1');
  });

  it('clear() limpia los tokens pero conserva el deviceToken', () => {
    service.setSession(tokens);
    service.clear();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
    expect(service.getRefreshToken()).toBeNull();
    expect(service.getDeviceToken()).toBe('device-1');
  });

  it('un token expirado no cuenta como autenticado', () => {
    service.setSession({ ...tokens, expiresInSeconds: -10 });
    expect(service.isAuthenticated()).toBe(false);
  });

  it('rehidrata la sesión desde localStorage en una instancia nueva', () => {
    service.setSession(tokens);
    const fresh = new TokenService();
    expect(fresh.isAuthenticated()).toBe(true);
    expect(fresh.getAccessToken()).toBe('access-1');
  });
});
