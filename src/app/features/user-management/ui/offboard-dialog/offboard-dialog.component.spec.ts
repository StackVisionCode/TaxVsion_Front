import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OffboardImpactItem } from '../../data-access/user-management.model';
import { UserManagementService } from '../../data-access/user-management.service';
import { OffboardImpactService } from '../../data-access/offboard-impact.service';
import { TeamMember } from '../user-table/user-table.component';
import { OffboardDialogComponent } from './offboard-dialog.component';

const item = (overrides: Partial<OffboardImpactItem>): OffboardImpactItem => ({
  key: 'appointments',
  label: 'Upcoming appointments',
  icon: 'calendar-outline',
  withSuccessor: 'move to {name}',
  withoutSuccessor: 'cancelled — clients are notified',
  count: 3,
  available: true,
  ...overrides,
});

const member = { id: 'u1', name: 'Ana Pérez', email: 'ana@example.com' } as TeamMember;

describe('OffboardDialogComponent', () => {
  function render(impact: OffboardImpactItem[]) {
    TestBed.configureTestingModule({
      imports: [OffboardDialogComponent],
      providers: [
        { provide: OffboardImpactService, useValue: { getOffboardImpact: () => of(impact) } },
        {
          provide: UserManagementService,
          useValue: { getEligibleSuccessors: () => of([{ id: 's1', name: 'Sam Lee', subtitle: 'Employee' }]) },
        },
      ],
    });
    const fixture = TestBed.createComponent(OffboardDialogComponent);
    fixture.componentInstance.member = member;
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  // app-modal porta su contenido a <body>.
  const q = (selector: string) => document.body.querySelector(selector);

  afterEach(() => TestBed.resetTestingModule());

  it('dice lo que de verdad pasa sin sucesor y cambia al elegir uno', () => {
    const fixture = render([item({}), item({ key: 'drafts', label: 'Email drafts', withoutSuccessor: 'discarded', count: 2 })]);

    expect(q('[data-impact="appointments"]')?.textContent?.trim()).toBe('cancelled — clients are notified');
    expect(q('[data-impact="drafts"]')?.textContent?.trim()).toBe('discarded');

    fixture.componentInstance.successorId.set('s1');
    fixture.detectChanges();

    expect(q('[data-impact="appointments"]')?.textContent?.trim()).toBe('move to Sam Lee');
    expect(q('[data-impact="drafts"]')?.textContent?.trim()).toBe('move to Sam Lee');
  });

  it('solo muestra lo que tiene algo y avisa si no hay nada asignado', () => {
    render([item({ count: 0 }), item({ key: 'mailboxes', available: false, count: 0 })]);

    expect(q('[data-testid="offboard-impact"]')).toBeNull();
    expect(q('[data-testid="offboard-nothing"]')?.textContent).toContain('Nothing is assigned to them');
    // El servicio que no respondió se avisa aparte.
    expect(document.body.textContent).toContain("Some services couldn't be reached");
  });

  it('mientras el retiro se ejecuta muestra la espera y no deja confirmar otra vez', () => {
    const fixture = render([item({})]);
    const emitted: unknown[] = [];
    fixture.componentInstance.confirmed.subscribe(request => emitted.push(request));
    fixture.componentInstance.acknowledged.set(true);
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();

    const button = q('[data-testid="offboard-confirm"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Offboarding…');
    expect(button.disabled).toBe(true);
    fixture.componentInstance.confirm();
    expect(emitted).toEqual([]);
  });

  it('manda el motivo con su nota, y sin motivo no manda la nota', () => {
    const fixture = render([item({})]);
    const emitted: unknown[] = [];
    fixture.componentInstance.confirmed.subscribe(request => emitted.push(request));
    fixture.componentInstance.acknowledged.set(true);

    fixture.componentInstance.reasonNote.set('  Moved away  ');
    fixture.componentInstance.confirm();
    fixture.componentInstance.reason.set('Resigned');
    fixture.componentInstance.confirm();

    expect(emitted).toEqual([
      { successorUserId: null, reason: null, reasonNote: null },
      { successorUserId: null, reason: 'Resigned', reasonNote: 'Moved away' },
    ]);
  });
});
