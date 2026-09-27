import { Component, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { HasPermissionDirective } from './has-permission.directive';

/** Fake reactivo: lee signals para que el `effect` de la directiva reaccione. */
class FakeAccess {
  readonly granted: WritableSignal<Set<string>> = signal(new Set<string>());
  readonly modules: WritableSignal<Set<string> | null> = signal<Set<string> | null>(null);

  can(p: string): boolean {
    return this.granted().has(p);
  }
  canAny(ps: readonly string[]): boolean {
    const set = this.granted();
    return ps.some(p => set.has(p));
  }
  canUse(requirement: AccessRequirement): boolean {
    const modules = this.modules();
    if (requirement.module !== null && modules !== null && !modules.has(requirement.module)) {
      return false;
    }
    return requirement.anyOf.length === 0 || this.canAny(requirement.anyOf);
  }
}

@Component({
  standalone: true,
  imports: [HasPermissionDirective],
  template: `
    <button *appHasPermission="'customers.manage'" data-testid="single">A</button>
    <button *appHasPermission="['customers.view', 'customers.manage']" data-testid="any">B</button>
    <button
      *appHasPermission="{ module: 'documents', anyOf: ['cloudstorage.file.delete'] }"
      data-testid="requirement"
    >
      C
    </button>
  `,
})
class HostComponent {}

describe('HasPermissionDirective', () => {
  let fake: FakeAccess;

  beforeEach(() => {
    fake = new FakeAccess();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: AccessStore, useValue: fake }],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  function shown(fixture: ReturnType<typeof render>, id: string): boolean {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`) !== null;
  }

  it('oculta el elemento cuando falta el permiso', () => {
    const fixture = render();

    expect(shown(fixture, 'single')).toBe(false);
    expect(shown(fixture, 'any')).toBe(false);
  });

  it('muestra con permiso exacto y con "alcanza con uno"', () => {
    fake.granted.set(new Set(['customers.view']));
    const fixture = render();

    expect(shown(fixture, 'single')).toBe(false);
    expect(shown(fixture, 'any')).toBe(true);
  });

  it('reacciona al cambiar los permisos', () => {
    const fixture = render();
    expect(shown(fixture, 'single')).toBe(false);

    fake.granted.set(new Set(['customers.manage']));
    fixture.detectChanges();

    expect(shown(fixture, 'single')).toBe(true);
  });

  // ---------- B6: el requisito completo, con módulo ----------

  it('con el permiso pero sin el módulo del plan, no se muestra', () => {
    // Es lo que la forma de string no podía expresar: el permiso está, el módulo no.
    fake.granted.set(new Set(['cloudstorage.file.delete']));
    fake.modules.set(new Set([]));
    const fixture = render();

    expect(shown(fixture, 'requirement')).toBe(false);
  });

  it('con el permiso y el módulo, se muestra', () => {
    fake.granted.set(new Set(['cloudstorage.file.delete']));
    fake.modules.set(new Set(['documents']));
    const fixture = render();

    expect(shown(fixture, 'requirement')).toBe(true);
  });

  it('sin bootstrap no esconde por plan', () => {
    // `modules === null` = "todavía no sé qué contrató la oficina". Esconder ahí sería más
    // estricto que el backend, cuyo gate de módulo está en log-only.
    fake.granted.set(new Set(['cloudstorage.file.delete']));
    const fixture = render();

    expect(shown(fixture, 'requirement')).toBe(true);
  });
});
