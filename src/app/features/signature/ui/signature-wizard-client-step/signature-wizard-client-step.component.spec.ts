import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { of } from 'rxjs';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { SignatureWizardClientStepComponent } from './signature-wizard-client-step.component';

function customer(partial: Partial<CustomerSummary> & Pick<CustomerSummary, 'id'>): CustomerSummary {
  return {
    kind: 'Individual',
    status: 'Active',
    displayName: 'Jane Doe',
    primaryEmail: 'jane@acme.com',
    primaryPhone: null,
    createdAtUtc: '2026-01-15T00:00:00Z',
    ...partial,
  };
}

/** Stub mínimo del directorio: el picker compartido solo lee recientes y busca. */
const directoryStub = {
  recent: () => [],
  search: () => of({ items: [], page: 1, size: 20, totalCount: 0, totalPages: 0, hasMore: false, hasPrevious: false }),
  byId: () => of(new Map()),
  addRecent: vi.fn(),
};

describe('SignatureWizardClientStepComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [SignatureWizardClientStepComponent],
      providers: [{ provide: CustomerDirectoryStore, useValue: directoryStub }],
    });
    const fixture = TestBed.createComponent(SignatureWizardClientStepComponent);
    return { c: fixture.componentInstance, fixture };
  }

  it('el filtro por tipo afina resultados y recientes', () => {
    const { c } = setup();
    c.recent = [customer({ id: 'a' }), customer({ id: 'b', kind: 'Business' })];
    c.ngOnChanges({ recent: new SimpleChange(null, c.recent, true) });

    c.typeFilter.set('company');
    expect(c.visibleRecent().map(x => x.id)).toEqual(['b']);
    expect(c.typeFilterFn()(customer({ id: 'a' }))).toBe(false);

    c.typeFilter.set('individual');
    expect(c.visibleRecent().map(x => x.id)).toEqual(['a']);
  });

  it('elegir un cliente lo emite; null (limpiar) no', () => {
    const { c } = setup();
    const emitted: CustomerSummary[] = [];
    c.picked.subscribe(x => emitted.push(x));

    const chosen = customer({ id: 'a' });
    c.onPicked(chosen);
    c.onPicked(null);

    expect(emitted).toEqual([chosen]);
  });

  it('un cliente nuevo cierra el buscador de "Change"', () => {
    const { c } = setup();
    c.changing.set(true);

    c.ngOnChanges({ selected: new SimpleChange(null, null, false) });

    expect(c.changing()).toBe(false);
  });
});
