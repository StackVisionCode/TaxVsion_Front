import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { UserManagementService } from '../../data-access/user-management.service';
import { UserEffectiveAccess } from '../../data-access/user-management.model';
import { TeamMember } from '../user-table/user-table.component';
import { EditAccessDrawerComponent } from './edit-access-drawer.component';

/**
 * El interruptor maestro de un módulo, probado COMO LO USA UNA PERSONA: pulsando el interruptor que
 * se ve (`app-switch`, un `<button role="switch">`). Antes era un checkbox de 0×0 detrás de un `.track`
 * y el maestro quedaba muerto para el usuario aunque un `input.click()` en el test pasara.
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

  /** El interruptor maestro: lo que la persona pulsa de verdad. */
  function master(fixture: ReturnType<typeof render>): HTMLButtonElement {
    return document.body.querySelector('button[role="switch"][aria-label^="Allow all of"]') as HTMLButtonElement;
  }

  /** Los interruptores de fila: todos menos el maestro. */
  function rowSwitches(fixture: ReturnType<typeof render>): HTMLButtonElement[] {
    return [...document.body.querySelectorAll('.perm-row button[role="switch"]')] as HTMLButtonElement[];
  }

  function rowStates(fixture: ReturnType<typeof render>): boolean[] {
    return rowSwitches(fixture).map(button => button.getAttribute('aria-checked') === 'true');
  }

  afterEach(() => TestBed.resetTestingModule());

  it('el maestro es un interruptor visible y accesible', () => {
    const fixture = render();
    expect(master(fixture)).not.toBeNull();
    expect(master(fixture).getAttribute('aria-checked')).toBe('true');
  });

  it('pulsar el maestro apaga TODAS las filas del módulo', () => {
    const fixture = render();
    expect(rowStates(fixture)).toEqual([true, true]);

    master(fixture).click();
    fixture.detectChanges();

    expect(rowStates(fixture)).toEqual([false, false]);
  });

  it('y volver a pulsarlo las enciende todas', () => {
    const fixture = render();
    master(fixture).click();
    fixture.detectChanges();

    master(fixture).click();
    fixture.detectChanges();

    expect(rowStates(fixture)).toEqual([true, true]);
  });

  it('cada fila se puede pulsar en el interruptor y también en su nombre (una sola vez)', () => {
    const fixture = render();
    rowSwitches(fixture)[0].click();
    fixture.detectChanges();
    expect(rowStates(fixture)).toEqual([false, true]);

    // Clic en el texto de la fila: el label activa el interruptor una única vez.
    const label = rowSwitches(fixture)[1].closest('label') as HTMLLabelElement;
    (label.querySelector('div') as HTMLElement).click();
    fixture.detectChanges();
    expect(rowStates(fixture)).toEqual([false, false]);
  });
});
