import { CustomerDetailResponse } from './clients.model';
import { buildSectionUpdate, sectionDraftFromDetail } from './client-section-edit.model';

/**
 * 7.4 — cada modal de Info edita solo su sección, pero el PATCH aplica SIEMPRE email, teléfono,
 * idioma, canal y ocupación: si la sección no los reenvía tal cual, se borran. Estas pruebas
 * fijan que editar una sección no pisa las demás.
 */
describe('client-section-edit · merge del PATCH por sección', () => {
  const DETAIL: CustomerDetailResponse = {
    id: 'cus-1',
    tenantId: 't-1',
    kind: 'Individual',
    status: 'Active',
    displayName: 'Ana María López',
    firstName: 'Ana',
    middleName: 'María',
    lastName: 'López',
    legalName: null,
    primaryEmail: 'ana@example.com',
    primaryPhone: '+15551234567',
    language: 'Es',
    preferredChannel: 'Sms',
    occupationId: 'occ-1',
    occupationName: 'Nurse',
    principalBusinessActivityId: null,
    principalBusinessActivityName: null,
    dateOfBirth: '1990-04-02',
    createdAtUtc: '2026-01-01T00:00:00Z',
    assignedPreparerUserId: null,
  };

  it('contact: cambia email/teléfono/preferencias y conserva la ocupación', () => {
    const draft = { ...sectionDraftFromDetail(DETAIL, 'contact'), email: ' new@example.com ', phone: '' };
    const req = buildSectionUpdate(DETAIL, draft);
    expect(req.primaryEmail).toBe('new@example.com');
    expect(req.primaryPhone).toBeNull();
    expect(req.language).toBe('Es');
    expect(req.occupationId).toBe('occ-1');
    // Identidad en null = el backend la conserva.
    expect(req.firstName).toBeNull();
    expect(req.lastName).toBeNull();
    expect(req.dateOfBirth).toBeNull();
  });

  it('personal: cambia el nombre sin tocar email, teléfono ni canal', () => {
    const draft = { ...sectionDraftFromDetail(DETAIL, 'personal'), firstName: 'Anna', middleName: '' };
    const req = buildSectionUpdate(DETAIL, draft);
    expect(req.firstName).toBe('Anna');
    // '' (no null) para poder borrar el segundo nombre.
    expect(req.middleName).toBe('');
    expect(req.lastName).toBe('López');
    expect(req.dateOfBirth).toBe('1990-04-02');
    expect(req.primaryEmail).toBe('ana@example.com');
    expect(req.primaryPhone).toBe('+15551234567');
    expect(req.preferredChannel).toBe('Sms');
    expect(req.occupationId).toBe('occ-1');
  });

  it('personal: quitar la ocupación la manda en null', () => {
    const draft = { ...sectionDraftFromDetail(DETAIL, 'personal'), occupationId: null };
    expect(buildSectionUpdate(DETAIL, draft).occupationId).toBeNull();
  });

  it('business: estructura sin elegir viaja en null (= conservar) y el contacto se preserva', () => {
    const business: CustomerDetailResponse = {
      ...DETAIL,
      kind: 'Business',
      displayName: 'Acme LLC',
      legalName: 'Acme LLC',
      firstName: null,
      middleName: null,
      lastName: null,
      principalBusinessActivityId: 'naics-1',
    };
    const draft = { ...sectionDraftFromDetail(business, 'business'), legalName: 'Acme Holdings LLC' };
    const req = buildSectionUpdate(business, draft);
    expect(req.legalName).toBe('Acme Holdings LLC');
    expect(req.businessStructure).toBeNull();
    expect(req.formationDate).toBeNull();
    expect(req.principalBusinessActivityId).toBe('naics-1');
    expect(req.primaryPhone).toBe('+15551234567');
    expect(req.firstName).toBeNull();
  });
});
