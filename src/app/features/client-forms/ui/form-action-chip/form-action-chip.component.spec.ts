import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormActionChipComponent } from './form-action-chip.component';

describe('FormActionChipComponent', () => {
  let fixture: ComponentFixture<FormActionChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormActionChipComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(FormActionChipComponent);
  });

  it('does not present Requested as a successful customer creation', () => {
    fixture.componentInstance.run = {
      id: 'run-1',
      revisionNumber: 1,
      actionKey: 'create',
      actionType: 'CreateCustomer',
      status: 'Requested',
      attempt: 1,
      requestedAtUtc: '2026-10-24T10:00:00',
      completedAtUtc: null,
      resultRefKind: null,
      resultRefId: null,
      existingCustomerId: null,
      errorCode: null,
      errorDetail: null,
      warnings: [],
      isLatestAttempt: true,
      canRetry: false,
    };
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Creating client…');
    expect(fixture.nativeElement.textContent).not.toContain('Client created');
  });
});
