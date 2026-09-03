import { Component, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionService } from '@core/auth/permission.service';
import { HasPermissionDirective } from './has-permission.directive';

/** Fake reactivo: `has` lee una signal para que el `effect` de la directiva reaccione. */
class FakePermissions {
  readonly granted: WritableSignal<Set<string>> = signal(new Set<string>());
  has(p: string): boolean {
    return this.granted().has(p);
  }
  hasAny(ps: readonly string[]): boolean {
    const set = this.granted();
    return ps.some(p => set.has(p));
  }
}

@Component({
  standalone: true,
  imports: [HasPermissionDirective],
  template: `
    <button *appHasPermission="'customers.manage'" data-testid="single">A</button>
    <button *appHasPermission="['customers.view', 'customers.manage']" data-testid="any">B</button>
  `,
})
class HostComponent {}

describe('HasPermissionDirective', () => {
  let fake: FakePermissions;

  beforeEach(() => {
    fake = new FakePermissions();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: PermissionService, useValue: fake }],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('oculta el elemento cuando falta el permiso', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('[data-testid="single"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="any"]')).toBeNull();
  });

  it('muestra con permiso exacto y con hasAny', () => {
    fake.granted.set(new Set(['customers.view']));
    const fixture = render();
    // 'single' exige customers.manage → oculto; 'any' incluye customers.view → visible
    expect(fixture.nativeElement.querySelector('[data-testid="single"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="any"]')).not.toBeNull();
  });

  it('reacciona al cambiar los permisos', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('[data-testid="single"]')).toBeNull();
    fake.granted.set(new Set(['customers.manage']));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="single"]')).not.toBeNull();
  });
});
