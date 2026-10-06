import { describe, expect, it } from 'vitest';
import type { CustomerDetailResponse } from '../data-access/clients.model';
import { buildSectionUpdateRequest } from './client-section-update';

const INDIVIDUAL: CustomerDetailResponse = {
  id: 'cus-1',
  tenantId: 't-1',
  kind: 'Individual',
  status: 'Active',
  displayName: 'Ana María López',
  firstName: 'Ana',
  middleName: 'María',
  lastName: 'López',
  primaryEmail: 'ana@example.com',
  primaryPhone: '+18095551234',
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

const BUSINESS: CustomerDetailResponse = {
  ...INDIVIDUAL,
  id: 'cus-2',
  kind: 'Business',
  displayName: 'Acme LLC',
  firstName: null,
  middleName: null,
  lastName: null,
  legalName: 'Acme LLC',
  occupationId: null,
  occupationName: null,
  dateOfBirth: null,
  principalBusinessActivityId: 'naics-1',
  principalBusinessActivityName: 'Bookkeeping',
};

describe('buildSectionUpdateRequest · cada sección conserva lo que no edita', () => {
  it('contacto: cambia email/teléfono/idioma/canal y conserva nombre, nacimiento y ocupación', () => {
    const req = buildSectionUpdateRequest(INDIVIDUAL, {
      section: 'contact',
      primaryEmail: 'new@example.com',
      primaryPhone: null,
      language: 'En',
      preferredChannel: 'Email',
    });
    expect(req).toEqual({
      language: 'En',
      preferredChannel: 'Email',
      primaryEmail: 'new@example.com',
      primaryPhone: null,
      occupationId: 'occ-1',
      firstName: 'Ana',
      middleName: 'María',
      lastName: 'López',
      dateOfBirth: '1990-04-02',
    });
  });

  it('personal: cambia nombre y ocupación sin tocar el teléfono ni las preferencias', () => {
    const req = buildSectionUpdateRequest(INDIVIDUAL, {
      section: 'personal',
      firstName: 'Anna',
      middleName: null,
      lastName: 'Lopez',
      dateOfBirth: null,
      occupationId: null,
    });
    // El teléfono y la ocupación se aplican SIEMPRE en el backend: si faltaran, se borrarían.
    expect(req.primaryPhone).toBe('+18095551234');
    expect(req.language).toBe('Es');
    expect(req.preferredChannel).toBe('Sms');
    expect(req.primaryEmail).toBe('ana@example.com');
    expect(req.firstName).toBe('Anna');
    expect(req.lastName).toBe('Lopez');
    expect(req.occupationId).toBeNull();
    // Sin fecha nueva se reenvía la vigente.
    expect(req.dateOfBirth).toBe('1990-04-02');
  });

  it('negocio: conserva contacto y actividad si no se elige otra; estructura null = conservar', () => {
    const req = buildSectionUpdateRequest(BUSINESS, {
      section: 'business',
      legalName: 'Acme Holdings LLC',
      businessStructure: null,
      formationDate: '2020-05-01',
      principalBusinessActivityId: null,
    });
    expect(req).toEqual({
      language: 'Es',
      preferredChannel: 'Sms',
      primaryEmail: 'ana@example.com',
      primaryPhone: '+18095551234',
      occupationId: null,
      legalName: 'Acme Holdings LLC',
      businessStructure: null,
      formationDate: '2020-05-01',
      principalBusinessActivityId: 'naics-1',
    });
  });

  it('negocio: una actividad elegida reemplaza la actual', () => {
    const req = buildSectionUpdateRequest(BUSINESS, {
      section: 'business',
      legalName: 'Acme LLC',
      businessStructure: 'SCorp',
      formationDate: null,
      principalBusinessActivityId: 'naics-9',
    });
    expect(req.principalBusinessActivityId).toBe('naics-9');
    expect(req.businessStructure).toBe('SCorp');
  });

  it('un cliente sin teléfono no inventa uno', () => {
    const req = buildSectionUpdateRequest({ ...INDIVIDUAL, primaryPhone: null }, {
      section: 'personal',
      firstName: 'Ana',
      middleName: null,
      lastName: 'López',
      dateOfBirth: '1991-01-01',
      occupationId: 'occ-2',
    });
    expect(req.primaryPhone).toBeNull();
    expect(req.dateOfBirth).toBe('1991-01-01');
  });
});
