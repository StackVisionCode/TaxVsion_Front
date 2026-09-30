import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { UserManagementService } from '../../data-access/user-management.service';
import { UserEffectiveAccess } from '../../data-access/user-management.model';
import { TeamMember } from '../user-table/user-table.component';
import { EditAccessDrawerComponent } from './edit-access-drawer.component';

/**
 * El interruptor maestro de un módulo, probado COMO LO USA UNA PERSONA: pulsando `.track`, que es
 * lo que se ve.
 *
 * El `<input>` del interruptor mide 0×0 y tiene `opacity: 0` — es imposible pulsarlo. Lo que
 * funcionaba en las filas era la asociación del `<label>` que las envuelve; la cabecera del módulo
 * usaba un `<span>`, así que el maestro estaba muerto para el usuario y VIVO para un test que
 * llamara a `input.click()`. Ese fue exactamente mi error al darlo por bueno: hay que pulsar lo que
 * se ve.
 */
describe('EditAccessDrawerComponent · interruptor maestro de módulo', () => {
  const ACCESS: UserEffectiveAccess = {
    userId: 'u1',
    actorType: 'TenantEmployee',
    roles: ['Employee'],
    modules: [
      {
        module: 'connectors',
        permissions: [
          { permissionId: 'p1', code: 'connectors.accounts.read', module: 'connectors', description: 'View accounts', denied: false },
          { permissionId: 'p2', code: 'connectors.accounts.connect_own', module: 'connectors', description: 'Connect own', denied: false },
        ],
      },
    ],
    permissionsVersion: 3,
  };

  class FakeService {
    getEffectiveAccess(): Observable<UserEffectiveAccess> {
      return of(ACCESS);
    }
    setPermissionOverrides(): Observable<void> {
      return of(undefined);
    }
  }

  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EditAccessDrawerComponent],
      providers: [
        { provide: UserManagementService, useClass: FakeService },
        { provide: AccessStore, useValue: { enabledModules: signal(null) } },
      ],
    });
    const fixture = TestBed.createComponent(EditAccessDrawerComponent);
    fixture.componentInstance.member = {
      id: 'u1',
      name: 'Andres Hernandez',
      email: 'a@example.com',
      actorType: 'TenantEmployee',
    } as TeamMember;
    fixture.componentInstance.catalog = [];
    fixture.detectChanges();
    return fixture;
  }

  /** El elemento que la persona pulsa de verdad. */
  function masterTrack(fixture: ReturnType<typeof render>): HTMLElement {
    const input = fixture.nativeElement.querySelector(
      'input[aria-label^="Allow all of"]',
    ) as HTMLInputElement;
    return input.parentElement!.querySelector('.track') as HTMLElement;
  }

  /** Los interruptores de fila: todos menos el maestro. */
  function rowInputs(fixture: ReturnType<typeof render>): HTMLInputElement[] {
    const all = fixture.nativeElement.querySelectorAll('.perm-row input[type=checkbox]');
    return [...all] as HTMLInputElement[];
  }

  function rowStates(fixture: ReturnType<typeof render>): boolean[] {
    return rowInputs(fixture).map(input => input.checked);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('el maestro vive dentro de un label, no de un span', () => {
    // Sin el label, un clic sobre `.track` no llega nunca al input de 0×0.
    const fixture = render();
    const input = fixture.nativeElement.querySelector('input[aria-label^="Allow all of"]') as HTMLInputElement;

    expect(input.closest('label')).not.toBeNull();
  });

  it('pulsar lo que se ve apaga TODAS las filas del módulo', () => {
    const fixture = render();
    expect(rowStates(fixture)).toEqual([true, true]);

    masterTrack(fixture).click();
    fixture.detectChanges();

    expect(rowStates(fixture)).toEqual([false, false]);
  });

  it('y volver a pulsarlo las enciende todas', () => {
    const fixture = render();
    masterTrack(fixture).click();
    fixture.detectChanges();

    masterTrack(fixture).click();
    fixture.detectChanges();

    expect(rowStates(fixture)).toEqual([true, true]);
  });

  it('cada fila también se puede pulsar por lo que se ve', () => {
    const fixture = render();
    const row = rowInputs(fixture)[0];
    const track = row.parentElement!.querySelector('.track') as HTMLElement;

    track.click();
    fixture.detectChanges();

    expect(row.checked).toBe(false);
  });
});
