import { describe, expect, it } from 'vitest';
import { OfficeCompliance } from '../data-access/company-settings.model';
import {
  canMarkWispReviewedToday,
  complianceDirty,
  complianceErrors,
  isWispReviewDue,
  toComplianceForm,
  toComplianceRequest,
  todayIso,
  todayIsoIn,
} from './compliance-rules';

/** Cumplimiento: mismas reglas que Tenant y el EFIN solo viaja si se cambia o se quita. */
describe('compliance-rules', () => {
  const TODAY = '2026-11-03';
  const SAVED: OfficeCompliance = {
    hasEfin: true,
    efinMasked: '••••23',
    securityCoordinatorUserId: 'u-1',
    wispAdoptedOn: '2025-01-15',
    wispLastReviewedOn: null,
    incidentContactEmail: 'security@castillo.com',
    incidentContactPhone: '(202) 555-0112',
    retentionYears: 7,
    updatedAtUtc: null,
  };

  it('sin tocar el EFIN, el PUT no lo lleva (omitido = no tocar)', () => {
    const request = toComplianceRequest(toComplianceForm(SAVED));

    expect(request).not.toHaveProperty('efin');
    expect(request).toEqual({
      securityCoordinatorUserId: 'u-1',
      wispAdoptedOn: '2025-01-15',
      wispLastReviewedOn: null,
      incidentContactEmail: 'security@castillo.com',
      incidentContactPhone: '(202) 555-0112',
      retentionYears: 7,
    });
  });

  it('quitar el EFIN manda "" y cambiarlo manda los 6 dígitos', () => {
    const form = toComplianceForm(SAVED);

    expect(toComplianceRequest({ ...form, efinAction: 'clear' }).efin).toBe('');
    expect(toComplianceRequest({ ...form, efinAction: 'change', efin: '654321' }).efin).toBe('654321');
  });

  it('vacíos viajan como null y el teléfono normalizado', () => {
    const request = toComplianceRequest({
      ...toComplianceForm(null),
      incidentContactPhone: '202 555 0199',
    });

    expect(request).toMatchObject({ securityCoordinatorUserId: null, retentionYears: null, incidentContactPhone: '(202) 555-0199' });
  });

  it('valida EFIN, fechas, contacto y retención', () => {
    const errors = complianceErrors(
      {
        ...toComplianceForm(SAVED),
        efinAction: 'change',
        efin: '123',
        wispAdoptedOn: '2027-01-01',
        wispLastReviewedOn: '2026-12-01',
        incidentContactEmail: 'nope',
        incidentContactPhone: '123',
        retentionYears: '21',
      },
      TODAY,
    );

    expect(Object.keys(errors).sort()).toEqual(
      ['efin', 'incidentEmail', 'incidentPhone', 'retentionYears', 'wispAdoptedOn', 'wispLastReviewedOn'].sort(),
    );
  });

  it('la revisión no puede ser anterior a la adopción', () => {
    const errors = complianceErrors({ ...toComplianceForm(SAVED), wispLastReviewedOn: '2024-12-31' }, TODAY);

    expect(errors.wispLastReviewedOn).toContain('before the adoption');
  });

  it('lo cargado no tiene cambios; pedir quitar el EFIN sí', () => {
    const form = toComplianceForm(SAVED);

    expect(complianceDirty(form, SAVED)).toBe(false);
    expect(complianceDirty({ ...form, efinAction: 'clear' }, SAVED)).toBe(true);
    expect(complianceDirty({ ...form, retentionYears: '' }, SAVED)).toBe(true);
  });

  it('"Review due" cuando la última revisión (o la adopción) pasó los 12 meses', () => {
    expect(isWispReviewDue('2025-11-03', null, TODAY)).toBe(false);
    expect(isWispReviewDue('2025-11-02', null, TODAY)).toBe(true);
    expect(isWispReviewDue('2020-01-01', '2026-06-01', TODAY)).toBe(false);
    expect(isWispReviewDue(null, null, TODAY)).toBe(false);
  });

  it('hoy en formato yyyy-MM-dd local', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('la retención acepta de 3 a 20 años', () => {
    const form = toComplianceForm(SAVED);

    expect(complianceErrors({ ...form, retentionYears: '20' }, TODAY).retentionYears).toBeUndefined();
    expect(complianceErrors({ ...form, retentionYears: '3' }, TODAY).retentionYears).toBeUndefined();
    expect(complianceErrors({ ...form, retentionYears: '2' }, TODAY).retentionYears).toContain('between 3 and 20');
  });

  it('hoy en la zona de la oficina; sin zona o con una inválida, la del navegador', () => {
    // 02:30 UTC del 4: en Nueva York todavía es el 3.
    const now = new Date(Date.UTC(2026, 10, 4, 2, 30));

    expect(todayIsoIn('America/New_York', now)).toBe('2026-11-03');
    expect(todayIsoIn('Asia/Tokyo', now)).toBe('2026-11-04');
    expect(todayIsoIn(null, now)).toBe(todayIso(now));
    expect(todayIsoIn('Not/AZone', now)).toBe(todayIso(now));
  });

  it('"Mark reviewed today" pide la adopción y que la revisión no sea ya hoy', () => {
    expect(canMarkWispReviewedToday('2025-01-15', '', TODAY)).toBe(true);
    expect(canMarkWispReviewedToday('2025-01-15', '2026-01-10', TODAY)).toBe(true);
    expect(canMarkWispReviewedToday('2025-01-15', TODAY, TODAY)).toBe(false);
    expect(canMarkWispReviewedToday('', '', TODAY)).toBe(false);
  });
});
