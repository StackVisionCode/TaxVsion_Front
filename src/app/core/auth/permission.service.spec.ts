import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { MeResponse } from './auth.model';
import { PermissionService } from './permission.service';

function me(partial: Partial<MeResponse>): MeResponse {
  return {
    id: 'u1',
    name: 'Test',
    lastName: 'User',
    email: 't@e.co',
    actorType: 'TenantEmployee',
    customerId: null,
    tenant: { id: 't1', name: 'Nexora', subDomain: 'nexora' },
    roles: [],
    permissions: [],
    timeZoneId: 'UTC',
    mfaEnabled: false,
    emailVerified: true,
    phoneVerified: false,
    phoneNumber: null,
    plan: null,
    ...partial,
  };
}

describe('PermissionService', () => {
  let current: WritableSignal<MeResponse | null>;
  let service: PermissionService;

  beforeEach(() => {
    current = signal<MeResponse | null>(null);
    TestBed.configureTestingModule({
      providers: [PermissionService, { provide: AuthService, useValue: { currentUser: current } }],
    });
    service = TestBed.inject(PermissionService);
  });

  it('sin sesión: todo false', () => {
    expect(service.has('customers.view')).toBe(false);
    expect(service.isAdmin()).toBe(false);
    expect(service.actorType()).toBe(null);
  });

  it('has / hasAny / hasAll leen permissions[]', () => {
    current.set(me({ permissions: ['customers.view', 'customers.manage'] }));
    expect(service.has('customers.manage')).toBe(true);
    expect(service.has('customers.fiscalprofile.reveal')).toBe(false);
    expect(service.hasAny(['x', 'customers.view'])).toBe(true);
    expect(service.hasAll(['customers.view', 'customers.manage'])).toBe(true);
    expect(service.hasAll(['customers.view', 'x'])).toBe(false);
  });

  it('isAdmin sigue actorType (TenantAdmin/PlatformAdmin)', () => {
    current.set(me({ actorType: 'TenantEmployee' }));
    expect(service.isAdmin()).toBe(false);
    current.set(me({ actorType: 'TenantAdmin' }));
    expect(service.isAdmin()).toBe(true);
    current.set(me({ actorType: 'PlatformAdmin' }));
    expect(service.isAdmin()).toBe(true);
    expect(service.isActor('PlatformAdmin', 'TenantAdmin')).toBe(true);
    expect(service.isActor('CustomerPortal')).toBe(false);
  });

  it('reactivo: cambia al mutar la sesión', () => {
    expect(service.has('customers.view')).toBe(false);
    current.set(me({ permissions: ['customers.view'] }));
    expect(service.has('customers.view')).toBe(true);
  });
});
