import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TeamMember, UserTableComponent } from './user-table.component';

/**
 * El estado 'removed' (offboarded) es terminal: se etiqueta "Removed" y usa un tono NEUTRO (gris
 * apagado), no el 'danger' de 'suspended' — no es un estado accionable. (Que el menú "..." se oculte en
 * filas removed es lógica de plantilla, cubierta por el build AOT + E2E.)
 */
describe('UserTableComponent — removed status', () => {
  const component = new UserTableComponent();

  it('labels removed as "Removed"', () => {
    expect(component.statusLabel('removed')).toBe('Removed');
  });

  it('uses a neutral (non-danger) tone for removed', () => {
    expect(component.statusTone('removed')).toBe('muted');
    expect(component.statusTone('suspended')).toBe('danger');
  });
});

/**
 * SG-8 — la columna "Slot #" y el badge "Gated" vienen del backend (SG-5). El picker admin
 * "Move up in order" / "Set to end" solo se ofrece cuando `canManageSlotPriority` es true (G-C4).
 */
describe('UserTableComponent — slot column', () => {
  function member(overrides: Partial<TeamMember> = {}): TeamMember {
    return {
      id: 'u1',
      kind: 'user',
      name: 'Ada Lovelace',
      initials: 'AL',
      avatarColor: 'bg-slate-200',
      email: 'ada@acme.test',
      roleNames: ['Admin'],
      actorType: 'TenantEmployee',
      status: 'active',
      activity: 'Joined Jan 1, 2024',
      slotIndex: 11,
      isGated: true,
      ...overrides,
    };
  }

  function render(members: TeamMember[], canManageSlotPriority: boolean) {
    TestBed.configureTestingModule({
      imports: [UserTableComponent],
    });
    const fixture = TestBed.createComponent(UserTableComponent);
    fixture.componentInstance.members = members;
    fixture.componentInstance.canManageSlotPriority = canManageSlotPriority;
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pinta el slotIndex y el badge Gated cuando el miembro los trae', () => {
    const fixture = render([member()], false);
    const slotCell = fixture.nativeElement.querySelector('[data-testid="slot-cell"]');

    expect(slotCell.textContent).toContain('11');
    expect(slotCell.querySelector('[data-testid="gated-badge"]')).toBeTruthy();
  });

  it('pinta la foto del usuario cuando trae avatarFileId', () => {
    const fixture = render([member({ avatarFileId: 'f-ada' })], false);
    const img = fixture.nativeElement.querySelector('app-avatar img') as HTMLImageElement | null;

    expect(img?.getAttribute('src')).toContain('/storage/avatars/f-ada');
  });

  it('sin slotIndex muestra el guión y no el badge', () => {
    const fixture = render([member({ slotIndex: null, isGated: false })], false);
    const slotCell = fixture.nativeElement.querySelector('[data-testid="slot-cell"]');

    expect(slotCell.textContent).toContain('—');
    expect(slotCell.querySelector('[data-testid="gated-badge"]')).toBeFalsy();
  });

  it('G-C4: las acciones "Move up"/"Set to end" solo aparecen si canManageSlotPriority es true', () => {
    // El `app-dropdown-menu` renderiza su contenido tras abrir con el trigger; se simula click.
    const openMenu = (fixture: ReturnType<typeof render>) => {
      const trigger = fixture.nativeElement.querySelector(
        '[aria-label="Member actions"]',
      ) as HTMLButtonElement | null;
      trigger?.click();
      fixture.detectChanges();
    };

    // El panel del menú se porta al body: se consulta en `document`.
    const fixtureFalse = render([member()], false);
    openMenu(fixtureFalse);
    expect(fixtureFalse.nativeElement.querySelector('[aria-label="Member actions"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="slot-move-up"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="slot-set-end"]')).toBeFalsy();
    TestBed.resetTestingModule();

    const fixtureTrue = render([member()], true);
    openMenu(fixtureTrue);
    expect(document.querySelector('[data-testid="slot-move-up"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="slot-set-end"]')).toBeTruthy();
  });
});
