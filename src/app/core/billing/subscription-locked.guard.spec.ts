import { afterEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { SubscriptionStatusStore } from './subscription-status.store';
import { SUBSCRIPTION_LOCKED_URL, subscriptionLockedCanActivateChild } from './subscription-locked.guard';

describe('subscriptionLockedCanActivateChild', () => {
  function run(locked: boolean): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SubscriptionStatusStore, useValue: { isLocked: signal(locked) } }],
    });
    return TestBed.runInInjectionContext(
      () =>
        subscriptionLockedCanActivateChild(
          {} as ActivatedRouteSnapshot,
          { url: '/clients' } as RouterStateSnapshot
        ) as boolean | UrlTree
    );
  }

  afterEach(() => TestBed.resetTestingModule());

  it('con la oficina sin pagar manda a la pantalla de pago', () => {
    const result = run(true);

    expect(result instanceof UrlTree).toBe(true);
    expect((result as UrlTree).toString()).toBe(SUBSCRIPTION_LOCKED_URL);
  });

  it('con la suscripción al día deja pasar', () => {
    expect(run(false)).toBe(true);
  });
});
