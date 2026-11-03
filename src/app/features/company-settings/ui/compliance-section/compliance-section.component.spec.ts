import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComplianceForm, OfficeCompliance } from '../../data-access/company-settings.model';
import { toComplianceForm } from '../../utils/compliance-rules';
import { ComplianceSectionComponent } from './compliance-section.component';

/** EFIN enmascarado: Reveal/Hide, cambiar y quitar; aviso de revisión del WISP. */
describe('ComplianceSectionComponent', () => {
  const SAVED: OfficeCompliance = {
    hasEfin: true,
    efinMasked: '••••23',
    securityCoordinatorUserId: 'gone-user',
    wispAdoptedOn: '2024-05-01',
    wispLastReviewedOn: null,
    incidentContactEmail: null,
    incidentContactPhone: null,
    retentionYears: 7,
    updatedAtUtc: null,
  };

  function setup(
    overrides: { compliance?: OfficeCompliance; form?: ComplianceForm; revealed?: string | null; disabled?: boolean } = {},
  ) {
    TestBed.configureTestingModule({ imports: [ComplianceSectionComponent] });
    const fixture = TestBed.createComponent(ComplianceSectionComponent);
    const compliance = overrides.compliance ?? SAVED;
    fixture.componentRef.setInput('compliance', compliance);
    fixture.componentRef.setInput('form', overrides.form ?? toComplianceForm(compliance));
    fixture.componentRef.setInput('revealedEfin', overrides.revealed ?? null);
    fixture.componentRef.setInput('coordinators', [{ userId: 'u-1', label: 'Ana Castillo · ana@castillo.com' }]);
    fixture.componentRef.setInput('today', '2026-11-03');
    fixture.componentRef.setInput('disabled', overrides.disabled ?? false);
    const emitted: { form: ComplianceForm[]; reveal: number; hide: number } = { form: [], reveal: 0, hide: 0 };
    fixture.componentInstance.formChange.subscribe(f => emitted.form.push(f));
    fixture.componentInstance.reveal.subscribe(() => emitted.reveal++);
    fixture.componentInstance.hide.subscribe(() => emitted.hide++);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined;
    return { fixture, el, emitted, button };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('muestra el EFIN enmascarado y Reveal pide revelarlo', () => {
    const { el, emitted, button } = setup();

    expect(el.textContent).toContain('••••23');
    button('Reveal')!.click();
    expect(emitted.reveal).toBe(1);
  });

  it('revelado muestra el número completo y se puede ocultar', () => {
    const { el, emitted, button } = setup({ revealed: '123423' });

    expect(el.textContent).toContain('123423');
    expect(button('Reveal')).toBeUndefined();
    button('Hide')!.click();
    expect(emitted.hide).toBe(1);
  });

  it('Remove marca el EFIN para borrar (y oculta lo revelado)', () => {
    const { emitted, button } = setup();

    button('Remove')!.click();

    expect(emitted.hide).toBe(1);
    expect(emitted.form.at(-1)).toMatchObject({ efinAction: 'clear', efin: '' });
  });

  it('en modo cambio solo acepta dígitos (máximo 6)', () => {
    const { el, emitted } = setup({ form: { ...toComplianceForm(SAVED), efinAction: 'change' } });
    const input = el.querySelector('input[maxlength="6"]') as HTMLInputElement;

    input.value = '12a34567';
    input.dispatchEvent(new Event('input'));

    expect(input.value).toBe('123456');
    expect(emitted.form.at(-1)?.efin).toBe('123456');
  });

  it('sin EFIN ofrece agregarlo', () => {
    const { el, button } = setup({ compliance: { ...SAVED, hasEfin: false, efinMasked: null } });

    expect(el.textContent).toContain('Not on file');
    expect(button('Add EFIN')).toBeDefined();
  });

  it('avisa "Review due" si la adopción pasó los 12 meses sin revisión', () => {
    const { el } = setup();

    expect(el.textContent).toContain('Review due');
  });

  it('"Mark reviewed today" pone la fecha de hoy como cambio sin guardar', () => {
    const { emitted, button } = setup();

    button('Mark reviewed today')!.click();

    expect(emitted.form.at(-1)?.wispLastReviewedOn).toBe('2026-11-03');
  });

  it('"Mark reviewed today" se deshabilita sin adopción, si ya es hoy o sin permiso de edición', () => {
    const noAdoption = setup({ form: { ...toComplianceForm(SAVED), wispAdoptedOn: '' } });
    expect(noAdoption.button('Mark reviewed today')!.disabled).toBe(true);
    TestBed.resetTestingModule();

    const already = setup({ form: { ...toComplianceForm(SAVED), wispLastReviewedOn: '2026-11-03' } });
    expect(already.button('Mark reviewed today')!.disabled).toBe(true);
    TestBed.resetTestingModule();

    const readOnly = setup({ disabled: true });
    expect(readOnly.button('Mark reviewed today')!.disabled).toBe(true);
  });

  it('ofrece la retención hasta 20 años', () => {
    const { el } = setup();
    const labels = Array.from(el.querySelectorAll('option')).map(o => o.textContent?.trim());

    expect(labels).toContain('3 years');
    expect(labels).toContain('20 years');
  });

  it('un responsable que ya no está en el equipo sigue visible', () => {
    const { el } = setup();
    const labels = Array.from(el.querySelectorAll('option')).map(o => o.textContent?.trim());

    expect(labels).toContain('Former team member');
    expect(labels).toContain('Ana Castillo · ana@castillo.com');
  });
});
