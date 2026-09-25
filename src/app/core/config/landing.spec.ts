import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { environment } from '@env/environment';
import { landingUrl, redirectToLandingGuard } from './landing';

describe('landingUrl', () => {
  it('joins the Landing origin with the path and query', () => {
    expect(landingUrl('/register?plan=pro&cycle=Monthly')).toBe(`${environment.landingUrl}/register?plan=pro&cycle=Monthly`);
  });

  it('accepts a path without the leading slash', () => {
    expect(landingUrl('register')).toBe(`${environment.landingUrl}/register`);
  });
});

describe('redirectToLandingGuard', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  });

  it('sends old /register links to the Landing with the same path and query', () => {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, replace },
      writable: true,
      configurable: true,
    });

    const result = redirectToLandingGuard(
      {} as ActivatedRouteSnapshot,
      { url: '/register/complete?token=abc' } as RouterStateSnapshot,
    );

    expect(result).toBe(false);
    expect(replace).toHaveBeenCalledWith(`${environment.landingUrl}/register/complete?token=abc`);
  });
});
