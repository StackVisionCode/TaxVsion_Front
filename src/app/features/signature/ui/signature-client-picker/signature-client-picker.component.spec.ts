import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SignatureClientPickerComponent } from './signature-client-picker.component';
import { SignatureStore } from '../../data-access/signature.store';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';

function client(partial: Partial<WizardClient> & Pick<WizardClient, 'id'>): WizardClient {
  return {
    displayName: 'Jane Doe',
    email: 'jane@acme.com',
    phone: '555-0100',
    type: 'individual',
    isActive: true,
    createdAt: '2026-01-15',
    ...partial,
  };
}

/** Stub mínimo: el picker sólo usa queryCustomers/loadCustomers y las 3 señales. */
class StoreStub {
  customers = signal<WizardClient[]>([]);
  customersLoading = signal(false);
  customersError = signal<string | null>(null);
  loadCustomers = vi.fn();
  queryCustomers = vi.fn();
}

describe('SignatureClientPickerComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [{ provide: SignatureStore, useClass: StoreStub }],
    });
    const fixture = TestBed.createComponent(SignatureClientPickerComponent);
    const store = TestBed.inject(SignatureStore) as unknown as StoreStub;
    return { c: fixture.componentInstance, store };
  }

  it('al abrir resetea filtro/búsqueda y refresca el lote', () => {
    const { c, store } = setup();
    c.typeFilter.set('company');
    c.search.set('acme');

    c.isOpen = true;

    expect(c.open()).toBe(true);
    expect(c.typeFilter()).toBe('all');
    expect(c.search()).toBe('');
    expect(store.queryCustomers).toHaveBeenCalledWith('');
  });

  it('filtra por tipo sobre las coincidencias del backend', () => {
    const { c, store } = setup();
    store.customers.set([client({ id: 'a', type: 'individual' }), client({ id: 'b', type: 'company' })]);

    c.setTypeFilter('company');

    expect(c.filtered().map(x => x.id)).toEqual(['b']);
  });

  it('select emite el cliente elegido', () => {
    const { c } = setup();
    const emitted: WizardClient[] = [];
    c.picked.subscribe(x => emitted.push(x));

    const chosen = client({ id: 'a' });
    c.select(chosen);

    expect(emitted).toEqual([chosen]);
  });

  it('close emite closed', () => {
    const { c } = setup();
    let closed = false;
    c.closed.subscribe(() => (closed = true));

    c.close();

    expect(closed).toBe(true);
  });
});
