import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { OffboardStatusDialogComponent } from './offboard-status-dialog.component';
import { OffboardImpactService } from '../../data-access/offboard-impact.service';
import { OffboardingStatus } from '../../data-access/user-management.model';

const status = (overrides: Partial<OffboardingStatus>): OffboardingStatus => ({
  status: 'InProgress',
  expected: 4,
  completed: 2,
  pending: [],
  startedAtUtc: '2026-11-03T10:00:00Z',
  completedAtUtc: null,
  ...overrides,
});

describe('OffboardStatusDialogComponent', () => {
  function create(getStatus: () => Observable<OffboardingStatus>) {
    TestBed.configureTestingModule({
      imports: [OffboardStatusDialogComponent],
      providers: [{ provide: OffboardImpactService, useValue: { getStatus } }],
    });
    const fixture = TestBed.createComponent(OffboardStatusDialogComponent);
    fixture.componentInstance.userId = 'u1';
    fixture.componentInstance.name = 'Ana';
    return fixture;
  }

  it('keeps asking while the areas confirm and stops when the handover is complete', async () => {
    const responses = [
      status({ completed: 2, pending: [{ service: 'Calendar', step: 'a', module: 'Calendar' }] }),
      status({ status: 'Completed', completed: 4, completedAtUtc: '2026-11-03T10:00:05Z' }),
    ];
    const getStatus = vi.fn(() => of(responses.shift()!));
    const fixture = create(getStatus);
    fixture.componentInstance.pollEveryMs = 5;

    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.status()?.status).toBe('InProgress');
    expect(fixture.componentInstance.pendingAreas()).toEqual(['Calendar']);

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fixture.componentInstance.status()?.status).toBe('Completed');
    expect(fixture.componentInstance.percent()).toBe(100);

    await new Promise(resolve => setTimeout(resolve, 40));
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('lists each pending area once, by its office-facing name', () => {
    const fixture = create(() =>
      of(
        status({
          status: 'Incomplete',
          pending: [
            { service: 'Communication', step: 'offboarding-consumers', module: 'Chat and meetings' },
            { service: 'Calendar', step: 'CalendarUserOffboardedConsumer', module: 'Calendar' },
            { service: 'Calendar', step: 'UserLifecyclePermissionsProjectionConsumer', module: 'Calendar' },
          ],
        }),
      ),
    );

    fixture.componentInstance.ngOnInit();

    expect(fixture.componentInstance.pendingAreas()).toEqual(['Chat and meetings', 'Calendar']);
    expect(fixture.componentInstance.statusLabel(fixture.componentInstance.status()!)).toBe('Needs attention');
  });

  it('explains an offboarding from before tracking instead of showing an error', () => {
    const fixture = create(() => throwError(() => new HttpErrorResponse({ status: 404 })));

    fixture.componentInstance.ngOnInit();

    expect(fixture.componentInstance.state()).toBe('untracked');
  });

  it('shows a retryable error for other failures', () => {
    const fixture = create(() => throwError(() => new HttpErrorResponse({ status: 503 })));

    fixture.componentInstance.ngOnInit();

    expect(fixture.componentInstance.state()).toBe('error');
  });
});
