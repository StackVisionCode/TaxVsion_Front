import { TestBed } from '@angular/core/testing';
import { SignatureWizardReviewStepComponent } from './signature-wizard-review-step.component';
import { RequestRules, PREPARER_PARTY_ID } from '../signature-request-panel/signature-wizard.model';
import { defaultRules } from '../signature-request-panel/signature-wizard.presenter';
import { SignatureCategoryPickerComponent } from '../signature-category-picker/signature-category-picker.component';

describe('SignatureWizardReviewStepComponent (reglas movidas desde el editor)', () => {
  function setup(canDeliverDocs: boolean) {
    TestBed.configureTestingModule({ imports: [SignatureWizardReviewStepComponent] });
    // El selector de categoría inyecta el store: no hace falta para estas pruebas.
    TestBed.overrideComponent(SignatureWizardReviewStepComponent, {
      remove: { imports: [SignatureCategoryPickerComponent] },
    });
    const fixture = TestBed.createComponent(SignatureWizardReviewStepComponent);
    const c = fixture.componentInstance;
    c.rules = defaultRules();
    c.canDeliverDocs = canDeliverDocs;
    c.signers = [
      {
        id: 'client:1',
        name: 'Ana',
        email: 'a@x.com',
        color: '',
        channel: 'email',
        phone: '',
        language: 'En',
      },
    ];
    c.fields = [
      {
        id: 'p',
        type: 'signature',
        page: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        signerId: PREPARER_PARTY_ID,
      },
    ];
    fixture.detectChanges();
    return { c, fixture };
  }

  it('emite el objeto de reglas completo con las mismas transformaciones', () => {
    const { c } = setup(true);
    const emitted: RequestRules[] = [];
    c.rulesChange.subscribe((r) => emitted.push(r));
    c.setSequential(false);
    c.setReminderIntervalDays(5);
    c.setSigningPin('12ab34');
    c.toggle('sendCertificate');
    expect(
      emitted.map((r) => [r.sequential, r.reminderIntervalHours, r.signingPin, r.sendCertificate]),
    ).toEqual([
      [false, 48, null, false],
      [true, 120, null, false],
      [true, 48, '1234', false],
      [true, 48, null, true],
    ]);
  });

  it('las entregas siguen detrás del mismo permiso (canDeliverDocs)', () => {
    expect(setup(false).fixture.nativeElement.textContent).not.toContain('Send signed document');
    TestBed.resetTestingModule();
    const { fixture } = setup(true);
    expect(fixture.nativeElement.textContent).toContain('Send signed document');
    expect(fixture.nativeElement.textContent).toContain('Signing PIN');
  });

  it('un firmante sin firma (la del preparador no cuenta) aparece con "Go to signer"', () => {
    const { c, fixture } = setup(true);
    const goTo: string[] = [];
    c.goToSigner.subscribe((id) => goTo.push(id));
    const blockers = fixture.nativeElement.querySelector(
      '[data-testid="review-blockers"]',
    ) as HTMLElement;
    expect(blockers.textContent).toContain('Ana needs a Signature or Initials field.');
    (blockers.querySelector('button') as HTMLButtonElement).click();
    expect(goTo).toEqual(['client:1']);
  });
});
