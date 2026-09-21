import { TestBed } from '@angular/core/testing';
import { ClientFiscalFormComponent, SaveFiscalPayload } from './client-fiscal-form.component';
import { CustomerFiscalProfileResponse, RelationResponse } from '../../data-access/clients.model';

const EXISTING: CustomerFiscalProfileResponse = {
  customerId: 'c1',
  subjectKind: 'Individual',
  taxIdentifierLast4: '6789',
  filingStatus: 'Single',
  priorYearAgi: null,
  isReturningCustomer: false,
  hasRefundBankInfo: false,
  updatedAtUtc: '2026-01-01T00:00:00Z',
  updatedByUserId: 'u1',
};

const SPOUSE: RelationResponse = {
  id: 'rel-spouse',
  relationshipKind: 'Spouse',
  purposes: 2,
  displayName: 'Ana López',
  primaryEmail: 'ana@example.com',
  primaryPhone: '+13055551234',
  dateOfBirth: '1990-04-02',
  isActive: true,
};

function setup(inputs: { existing?: CustomerFiscalProfileResponse | null; spouse?: RelationResponse | null }) {
  const fixture = TestBed.createComponent(ClientFiscalFormComponent);
  fixture.componentRef.setInput('existing', 'existing' in inputs ? inputs.existing : EXISTING);
  fixture.componentRef.setInput('spouse', inputs.spouse ?? null);
  fixture.componentRef.setInput('isOpen', true);
  fixture.detectChanges();
  const component = fixture.componentInstance;
  const emitted: SaveFiscalPayload[] = [];
  component.save.subscribe(payload => emitted.push(payload));
  return { fixture, component, emitted };
}

describe('ClientFiscalFormComponent — cónyuge con "Married filing jointly"', () => {
  it('solo muestra el bloque del cónyuge con MarriedJoint', () => {
    const { component } = setup({});
    expect(component.showSpouse()).toBe(false);
    component.filingStatus.set('MarriedJoint');
    expect(component.showSpouse()).toBe(true);
  });

  it('precarga el cónyuge en ficha', () => {
    const { component } = setup({ spouse: SPOUSE });
    expect(component.spouseOnFile()).toBe(true);
    expect(component.spouseFirstName()).toBe('Ana');
    expect(component.spouseLastName()).toBe('López');
    expect(component.spouseDob()).toBe('1990-04-02');
  });

  it('sin cónyuge y bloque vacío: guarda el perfil sin cónyuge (la invitación es opcional)', () => {
    const { component, emitted } = setup({});
    component.filingStatus.set('MarriedJoint');
    component.submit();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].spouse).toBeNull();
  });

  it('sin cónyuge y datos escritos: pide crearlo con su SSN en dígitos', () => {
    const { component, emitted } = setup({});
    component.filingStatus.set('MarriedJoint');
    component.spouseFirstName.set('Ana');
    component.spouseLastName.set('López');
    component.onSpouseSsnInput('123456789');
    component.submit();
    expect(emitted[0].spouse).toEqual({
      id: null,
      req: expect.objectContaining({ relationshipKind: 'Spouse', firstName: 'Ana', lastName: 'López' }),
      taxIdentifier: '123456789',
    });
  });

  it('cónyuge en ficha sin cambios ni SSN: no pide PATCH', () => {
    const { component, emitted } = setup({ spouse: SPOUSE });
    component.filingStatus.set('MarriedJoint');
    component.submit();
    expect(emitted[0].spouse).toEqual({ id: 'rel-spouse', req: null, taxIdentifier: null });
  });

  it('cónyuge en ficha editado: pide PATCH sobre su id', () => {
    const { component, emitted } = setup({ spouse: SPOUSE });
    component.filingStatus.set('MarriedJoint');
    component.spouseLastName.set('Gómez');
    component.submit();
    expect(emitted[0].spouse?.id).toBe('rel-spouse');
    expect(emitted[0].spouse?.req?.lastName).toBe('Gómez');
  });

  it('SSN del cónyuge inválido: no emite y muestra el error', () => {
    const { component, emitted } = setup({ spouse: SPOUSE });
    component.filingStatus.set('MarriedJoint');
    component.onSpouseSsnInput('000121234');
    component.submit();
    expect(emitted).toHaveLength(0);
    expect(component.spouseErr()).toContain('SSN');
  });

  it('con otro estado civil no envía el cónyuge aunque esté en ficha', () => {
    const { component, emitted } = setup({ spouse: SPOUSE });
    component.filingStatus.set('Single');
    component.submit();
    expect(emitted[0].spouse).toBeNull();
  });

  it('isEdit sigue a `existing` (antes quedaba congelado en el primer valor)', () => {
    const { fixture, component } = setup({ existing: null });
    expect(component.isEdit()).toBe(false);
    fixture.componentRef.setInput('existing', EXISTING);
    fixture.detectChanges();
    expect(component.isEdit()).toBe(true);
  });
});
