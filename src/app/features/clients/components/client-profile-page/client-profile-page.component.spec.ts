import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ClientProfilePageComponent } from './client-profile-page.component';
import { ClientsStore } from '../../data-access/clients.store';
import { ClientPermissions } from '../../data-access/client-permissions';
import {
  AddRelationRequest,
  CustomerDetailResponse,
  RelationResponse,
  SetRelationFiscalProfileRequest,
} from '../../data-access/clients.model';

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
    primaryPhone: null,
    language: 'Es',
    preferredChannel: 'Email',
    occupationId: null,
    occupationName: null,
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
}

async function setup(): Promise<{ component: ClientProfilePageComponent; store: FakeClientsStore; detect: () => void }> {
  const store = new FakeClientsStore();
  const paramMap = convertToParamMap({ id: 'c1' });
  TestBed.configureTestingModule({
    imports: [ClientProfilePageComponent],
    providers: [
      { provide: ClientsStore, useValue: store },
      { provide: ClientPermissions, useValue: { canSetFiscalProfile: signal(true) } },
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
