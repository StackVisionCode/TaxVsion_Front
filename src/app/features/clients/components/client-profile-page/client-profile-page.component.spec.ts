import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { ClientProfilePageComponent } from './client-profile-page.component';
import { ClientsStore } from '../../data-access/clients.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import {
  AddRelationRequest,
  CustomerDetailResponse,
  RelationResponse,
  RevealedTaxIdentifierResponse,
  SetRelationFiscalProfileRequest,
  UpdateCustomerRequest,
} from '../../data-access/clients.model';
import { ClientSaveOptions } from '../../data-access/clients.store';
import { ClientItem } from '../../ui/client-table/client-table.component';

const SPOUSE: RelationResponse = {
  id: 'rel-spouse',
  relationshipKind: 'Spouse',
  purposes: 2,
  displayName: 'Ana López',
  primaryEmail: 'ana@example.com',
  primaryPhone: null,
  dateOfBirth: '1990-04-02',
  isActive: true,
};

function detail(relations: RelationResponse[]): CustomerDetailResponse {
  return {
    id: 'c1',
    tenantId: 't1',
    kind: 'Individual',
    status: 'Active',
    displayName: 'Juan Pérez',
    primaryEmail: 'juan@example.com',
    primaryPhone: '+15551234567',
    language: 'Es',
    preferredChannel: 'Email',
    occupationId: 'occ-1',
    occupationName: 'Nurse',
    firstName: 'Juan',
    middleName: null,
    lastName: 'Pérez',
    principalBusinessActivityId: null,
    principalBusinessActivityName: null,
    createdAtUtc: '2026-01-01T00:00:00Z',
    assignedPreparerUserId: null,
    relations,
  };
}

/** Store falso: PATCH de relación responde como el backend real (204 ⇒ Angular emite `null`). */
class FakeClientsStore {
  getByIdCalls = 0;
  relations: RelationResponse[] = [SPOUSE];

  getById(): Observable<CustomerDetailResponse> {
    this.getByIdCalls++;
    return of(detail(this.relations));
  }

  updateRelation(_customerId: string, _relationId: string, req: AddRelationRequest): Observable<void> {
    this.relations = [{ ...SPOUSE, displayName: `${req.firstName} ${req.lastName}` }];
    return of(null as unknown as void);
  }

  calls: string[] = [];
  relationFiscal: { relationId: string; req: SetRelationFiscalProfileRequest } | null = null;

  setFiscalProfile(): Observable<unknown> {
    this.calls.push('fiscal');
    return of({});
  }

  addRelation(_customerId: string, req: AddRelationRequest): Observable<RelationResponse> {
    this.calls.push('addRelation');
    const created = { ...SPOUSE, id: 'rel-new', displayName: `${req.firstName} ${req.lastName}` };
    this.relations = [created];
    return of(created);
  }

  setRelationFiscalProfile(_customerId: string, relationId: string, req: SetRelationFiscalProfileRequest): Observable<unknown> {
    this.calls.push('relationFiscal');
    this.relationFiscal = { relationId, req };
    return of({});
  }

  updated: { req: UpdateCustomerRequest; options: ClientSaveOptions } | null = null;

  updateClient(_id: string, req: UpdateCustomerRequest, options: ClientSaveOptions): Observable<ClientItem> {
    this.updated = { req, options };
    return of({} as ClientItem);
  }

  revealTaxIdentifier(id: string): Observable<RevealedTaxIdentifierResponse> {
    return of({ customerId: id, subjectKind: 'Individual', taxIdentifier: '123-45-6789' });
  }
}

async function setup(): Promise<{ component: ClientProfilePageComponent; store: FakeClientsStore; detect: () => void }> {
  const store = new FakeClientsStore();
  const paramMap = convertToParamMap({ id: 'c1' });
  TestBed.configureTestingModule({
    imports: [ClientProfilePageComponent],
    providers: [
      { provide: ClientsStore, useValue: store },
      // canViewAssignees: el overview lo lee desde que existe la sección de asignados (Client Assignment).
      {
        provide: ClientPermissions,
        useValue: {
          canSetFiscalProfile: signal(true),
          canViewAssignees: signal(false),
          // B5: la cabecera y las pestañas Info/Family consultan estas dos.
          canManage: signal(true),
          canRevealFiscal: signal(true),
        },
      },
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
    ],
  });
  // Los `@defer` de la plantilla dejan metadata perezosa: hay que compilar antes de crear.
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(ClientProfilePageComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, store, detect: () => fixture.detectChanges() };
}

describe('ClientProfilePageComponent — edición de relaciones', () => {
  it('editar el cónyuge (PATCH 204, body null) termina de guardar y recarga el detalle', async () => {
    const { component, store, detect } = await setup();
    expect(store.getByIdCalls).toBe(1);

    component.handleSaveRelation({
      id: SPOUSE.id,
      req: { relationshipKind: 'Spouse', purposes: 2, firstName: 'Ana', lastName: 'Gómez' },
    });

    expect(component.savingRelation()).toBe(false);
    expect(component.relationError()).toBeNull();
    expect(store.getByIdCalls).toBe(2);
    expect(component.client()?.relations[0].displayName).toBe('Ana Gómez');
    expect(() => detect()).not.toThrow();
  });

  it('perfil fiscal con cónyuge nuevo + SSN: PUT perfil → POST cónyuge → PUT SSN sobre el id creado', async () => {
    const { component, store } = await setup();
    store.relations = [];
    component.openFiscalForm();

    component.handleSaveFiscal({
      profile: { subjectKind: 'Individual', taxIdentifier: null, filingStatus: 'MarriedJoint', isReturningCustomer: false },
      spouse: {
        id: null,
        req: { relationshipKind: 'Spouse', purposes: 2, firstName: 'Ana', lastName: 'López' },
        taxIdentifier: '123456789',
      },
    });

    expect(store.calls).toEqual(['fiscal', 'addRelation', 'relationFiscal']);
    expect(store.relationFiscal?.relationId).toBe('rel-new');
    expect(store.relationFiscal?.req).toEqual(
      expect.objectContaining({ role: 'Spouse', taxIdentifier: '123456789', qualifiesAsDependent: false }),
    );
    expect(component.savingFiscal()).toBe(false);
    expect(component.isFiscalFormOpen()).toBe(false);
    expect(component.spouseRelation()?.id).toBe('rel-new');
  });
});

describe('ClientProfilePageComponent · edición por sección y reveal', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('guardar "Personal details" conserva email, teléfono y ocupación del detalle actual', async () => {
    const { component, store } = await setup();
    component.openSectionEdit('personal');
    const initial = component.sectionInitial();
    if (initial?.section !== 'personal') {
      throw new Error('se esperaba el borrador de Personal details');
    }

    component.handleSaveSection({ ...initial, firstName: 'Juana' });

    expect(store.updated?.req).toEqual(
      expect.objectContaining({
        firstName: 'Juana',
        lastName: 'Pérez',
        primaryEmail: 'juan@example.com',
        primaryPhone: '+15551234567',
        occupationId: 'occ-1',
      }),
    );
    // Ni estado ni SSN: la edición por sección no toca lo que no es suyo.
    expect(store.updated?.options).toEqual({ taxIdentifier: '', subjectKind: 'Individual', isActive: true });
    expect(component.editSection()).toBeNull();
  });

  it('el SSN revelado se re-enmascara solo a los 30 s y al cambiar de pestaña', async () => {
    const { component } = await setup();
    vi.useFakeTimers();

    component.handleRevealTaxId('c1');
    expect(component.revealedTaxId()).toBe('123-45-6789');
    vi.advanceTimersByTime(29_000);
    expect(component.revealedTaxId()).toBe('123-45-6789');
    vi.advanceTimersByTime(1_500);
    expect(component.revealedTaxId()).toBeNull();

    component.handleRevealTaxId('c1');
    component.selectTab('info');
    expect(component.revealedTaxId()).toBeNull();
  });
});
