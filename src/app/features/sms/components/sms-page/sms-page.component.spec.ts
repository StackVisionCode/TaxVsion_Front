import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { WalletStore } from '@features/wallet/data-access/wallet.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SmsCapabilities } from '../../data-access/sms-permissions';
import { SmsStore } from '../../data-access/sms.store';
import { SmsPageComponent } from './sms-page.component';

const TERM_STATE_KEY = 'smsConvTerm';

/**
 * El término de búsqueda (nombre/teléfono/email) no se escribe en la URL: vive en `history.state`
 * (refresh y volver atrás lo conservan) y un `?term=` de enlaces viejos se lee una vez y se quita.
 */
describe('SmsPageComponent · término fuera de la URL', () => {
  function createStore() {
    const convTerm = signal('');
    const convPage = signal(1);
    return {
      convTerm: convTerm.asReadonly(),
      convPage: convPage.asReadonly(),
      initConversations: vi.fn((q: { term?: string; page?: number }) => {
        if (q.term !== undefined) convTerm.set(q.term);
        if (q.page !== undefined) convPage.set(q.page);
      }),
      setConvTerm: vi.fn((t: string) => {
        convTerm.set(t);
        convPage.set(1);
      }),
      goToConvPage: vi.fn((p: number) => convPage.set(p)),
      setSize: vi.fn(),
      setStatus: vi.fn(),
    };
  }

  function render(queryParams: Record<string, string> = {}) {
    const store = createStore();
    const router = { navigate: vi.fn(() => Promise.resolve(true)) };
    TestBed.configureTestingModule({
      imports: [SmsPageComponent],
      providers: [
        { provide: SmsStore, useValue: store },
        { provide: SmsCapabilities, useValue: { canRead: () => true, canSend: () => true, canManage: () => false } },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: CustomerDirectoryStore, useValue: { byId: vi.fn() } },
        { provide: WalletStore, useValue: {} },
      ],
    });
    // La plantilla (y sus hijos) no participa en el contrato de URL/estado que se prueba aquí.
    TestBed.overrideComponent(SmsPageComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(SmsPageComponent);
    fixture.detectChanges(); // corre ngOnInit (una sola vez)
    return { component: fixture.componentInstance, store, router };
  }

  const flush = () => new Promise(resolve => setTimeout(resolve));
  const stateTerm = () => (history.state as Record<string, unknown> | null)?.[TERM_STATE_KEY];

  beforeEach(() => history.replaceState(null, ''));
  afterEach(() => {
    history.replaceState(null, '');
    TestBed.resetTestingModule();
  });

  it('al buscar no escribe el término en la URL y lo guarda en history.state', async () => {
    const { component, store, router } = render();

    component.onSearch('ana@example.com');
    await flush();

    expect(store.setConvTerm).toHaveBeenCalledWith('ana@example.com');
    const [, extras] = router.navigate.mock.calls.at(-1) as unknown as [unknown[], { queryParams: Record<string, unknown> }];
    expect(extras.queryParams).toEqual({ term: null, page: null });
    expect(stateTerm()).toBe('ana@example.com');
  });

  it('la paginación sigue en la URL y conserva el término en el state', async () => {
    const { component, router } = render();

    component.onSearch('ana');
    component.onPage(3);
    await flush();

    const [, extras] = router.navigate.mock.calls.at(-1) as unknown as [unknown[], { queryParams: Record<string, unknown> }];
    expect(extras.queryParams).toEqual({ term: null, page: 3 });
    expect(stateTerm()).toBe('ana');
  });

  it('al recargar restaura el término desde history.state (sin tocar la URL)', () => {
    history.replaceState({ [TERM_STATE_KEY]: 'bob' }, '');

    const { component, store, router } = render({ page: '2' });

    expect(store.initConversations).toHaveBeenCalledWith({ term: 'bob', page: 2 });
    expect(component.searchText()).toBe('bob');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('un ?term= de un enlace viejo se lee una vez y se quita de la barra', async () => {
    const { store, router } = render({ term: 'carol', page: '2' });
    await flush();

    expect(store.initConversations).toHaveBeenCalledWith({ term: 'carol', page: 2 });
    expect(router.navigate).toHaveBeenCalledTimes(1);
    const [, extras] = router.navigate.mock.calls[0] as unknown as [
      unknown[],
      { queryParams: Record<string, unknown>; replaceUrl: boolean },
    ];
    expect(extras.queryParams).toEqual({ term: null, page: 2 });
    expect(extras.replaceUrl).toBe(true);
    expect(stateTerm()).toBe('carol');
  });

  it('el término guardado en el state gana sobre un ?term= viejo', () => {
    history.replaceState({ [TERM_STATE_KEY]: 'dave' }, '');

    const { store } = render({ term: 'old' });

    expect(store.initConversations).toHaveBeenCalledWith({ term: 'dave', page: 1 });
  });
});
