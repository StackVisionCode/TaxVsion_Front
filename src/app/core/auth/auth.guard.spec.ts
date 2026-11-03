import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/** JWT sin firma válida: el guard solo lee el claim `actor_type` (la firma la valida el backend). */
function tokenFor(actorType: string): string {
  const payload = btoa(JSON.stringify({ actor_type: actorType })).replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('authGuard', () => {
  const logoutLocal = vi.fn();
  let accessToken = '';

  beforeEach(() => {
    logoutLocal.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TokenService, useValue: { isAuthenticated: () => true, getAccessToken: () => accessToken } },
        {
          provide: AuthService,
          useValue: { logoutLocal, termsAccepted: () => true, mustEnrollMfa: () => false },
        },
      ],
    });
  });

  const run = () =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/dashboard' } as RouterStateSnapshot),
    );

  it('saca al PlatformAdmin del CRM sin explicar el motivo', () => {
    accessToken = tokenFor('PlatformAdmin');

    const result = run();

    expect(logoutLocal).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('deja pasar al personal de la oficina', () => {
    accessToken = tokenFor('TenantAdmin');

    expect(run()).toBe(true);
    expect(logoutLocal).not.toHaveBeenCalled();
  });
});
