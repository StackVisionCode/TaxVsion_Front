import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SeatResponse } from '../../data-access/seats.model';
import { SeatsStore } from '../../data-access/seats.store';
import { SeatsPanelComponent } from './seats-panel.component';

function seat(overrides: Partial<SeatResponse> = {}): SeatResponse {
  return {
    id: 'seat-1',
    tenantId: 't1',
    type: 'Standard',
    status: 'Available',
    currentUserId: null,
    nextRenewalAtUtc: '2026-10-16T00:00:00Z',
    autoRenew: true,
    billingCycle: 'Monthly',
    ...overrides,
  } as SeatResponse;
}

/**
 * Repartir asientos se mudó desde la pantalla de suscripción, que salió del CRM: ahora vive con las
 * personas, que es sobre quienes se decide. Lo que se fija acá es que el reparto sigue funcionando igual.
 */
describe('SeatsPanelComponent', () => {
  function create(seats: SeatResponse[] = [seat()]) {
    const calls: string[] = [];
    const storeStub = {
      pageSize: 20,
      seats: signal(seats),
      page: signal(1),
      total: signal(seats.length),
      loading: signal(false),
      error: signal<string | null>(null),
      busy: signal(false),
      actionError: signal<string | null>(null),
      load: () => calls.push('load'),
      assign: (id: string, userId: string, done: () => void) => {
        calls.push(`assign:${id}:${userId}`);
        done();
      },
      reassign: (id: string, userId: string, reason: string | null, done: () => void) => {
        calls.push(`reassign:${id}:${userId}:${reason}`);
        done();
      },
      release: (id: string, reason: string | null, done: () => void) => {
        calls.push(`release:${id}:${reason}`);
        done();
      },
    };
    TestBed.configureTestingModule({
      imports: [SeatsPanelComponent],
      providers: [{ provide: SeatsStore, useValue: storeStub }],
    });
    const fixture = TestBed.createComponent(SeatsPanelComponent);
    fixture.componentRef.setInput('teammates', [
      { id: 'u1', kind: 'user', name: 'Ada Lovelace', initials: 'AL', avatarColor: '', email: 'ada@acme.test', roleNames: [], actorType: 'TenantEmployee', status: 'active', activity: '' },
    ]);
    fixture.detectChanges();
    return { component: fixture.componentInstance, page: fixture.nativeElement as HTMLElement, calls };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pide los asientos al abrirse', () => {
    const { calls } = create();

    expect(calls).toContain('load');
  });

  it('un asiento libre se asigna; uno ocupado se reasigna con su motivo', () => {
    const { component, calls } = create();

    component.openAssign(seat());
    component.assignUserId.set('u1');
    component.confirmAssign();

    component.openAssign(seat({ currentUserId: 'u1' }));
    component.assignUserId.set('u2');
    component.assignReason.set('cambio de equipo');
    component.confirmAssign();

    expect(calls).toContain('assign:seat-1:u1');
    expect(calls).toContain('reassign:seat-1:u2:cambio de equipo');
  });

  it('liberar deja el motivo en null cuando no se escribe ninguno', () => {
    const { component, calls } = create();

    component.openRelease(seat({ currentUserId: 'u1' }));
    component.confirmRelease();

    expect(calls).toContain('release:seat-1:null');
  });

  // Un asiento sin dueño se lee de un vistazo; con dueño, se dice quién es.
  it('dice quién ocupa cada asiento', () => {
    const { component } = create();

    expect(component.userLabel(null)).toBe('Unassigned');
    expect(component.userLabel('u1')).toBe('Ada Lovelace');
    expect(component.userLabel('desconocido')).toBe('desconocido');
  });
});
