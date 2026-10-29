import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { prospect } from '../testing/prospect.fixture';
import type { FormProspect, PagedResult } from './client-forms.model';
import { FormProspectsService } from './form-prospects.service';
import { FormProspectsStore } from './form-prospects.store';
import { FormRequestsService } from './form-requests.service';

const page = (items: FormProspect[], totalCount = items.length): PagedResult<FormProspect> => ({
  items,
  page: 1,
  size: 25,
  totalCount,
});

describe('FormProspectsStore', () => {
  const service = { list: vi.fn(), markLost: vi.fn(), reopen: vi.fn() };
  const requests = { startCustomerCreation: vi.fn() };

  function setup(): FormProspectsStore {
    TestBed.configureTestingModule({
      providers: [
        FormProspectsStore,
        { provide: FormProspectsService, useValue: service },
        { provide: FormRequestsService, useValue: requests },
      ],
    });
    return TestBed.inject(FormProspectsStore);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service.list.mockReturnValue(of(page([prospect()], 1)));
  });

  it('loads the first page with the default size', async () => {
    const store = setup();

    await store.load();

    expect(service.list).toHaveBeenCalledWith({ status: null, search: null, page: 1, size: 25 });
    expect(store.items()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.loaded()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('keeps the error and the previous rows when a load fails', async () => {
    const store = setup();
    await store.load();
    service.list.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'X', message: 'Boom' } })),
    );

    await store.load();

    expect(store.error()).toBe('Boom');
    expect(store.items()).toHaveLength(1);
  });

  it('filters by status and search and resets to the first page', async () => {
    const store = setup();
    await store.goToPage(3);

    await store.setStatus('Lost');
    expect(service.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'Lost', page: 1 }),
    );

    await store.goToPage(2);
    await store.setSearch('  ana  ');
    expect(service.list).toHaveBeenLastCalledWith({ status: 'Lost', search: 'ana', page: 1, size: 25 });

    await store.setSearch('   ');
    expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: null }));
  });

  it('pages on the server', async () => {
    const store = setup();
    await store.goToPage(2);
    expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(store.filters().page).toBe(2);
  });

  it('ignores a slower response from an earlier load', async () => {
    const slow = new Subject<PagedResult<FormProspect>>();
    service.list.mockReturnValueOnce(slow).mockReturnValueOnce(of(page([prospect({ email: 'new@example.com' })])));
    const store = setup();

    const first = store.setSearch('a');
    await store.setSearch('an');
    slow.next(page([prospect({ email: 'old@example.com' })]));
    slow.complete();
    await first;

    expect(store.items()[0].email).toBe('new@example.com');
  });

  it('marks a prospect as lost with a trimmed reason and replaces the row', async () => {
    const store = setup();
    await store.load();
    service.markLost.mockReturnValue(of(prospect({ status: 'Lost', lostReason: 'Went elsewhere' })));

    expect(await store.markLost('participant-1', '  Went elsewhere ')).toBe(true);

    expect(service.markLost).toHaveBeenCalledWith('participant-1', 'Went elsewhere');
    expect(store.items()[0].status).toBe('Lost');
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(store.busyId()).toBeNull();
  });

  it('sends a null reason when it is blank', async () => {
    const store = setup();
    await store.load();
    service.markLost.mockReturnValue(of(prospect({ status: 'Lost' })));

    await store.markLost('participant-1', '   ');

    expect(service.markLost).toHaveBeenCalledWith('participant-1', null);
  });

  it('reloads when the updated row no longer matches the status filter', async () => {
    const store = setup();
    await store.setStatus('Lost');
    service.reopen.mockReturnValue(of(prospect({ status: 'Submitted' })));

    expect(await store.reopen('participant-1')).toBe(true);

    expect(service.reopen).toHaveBeenCalledWith('participant-1');
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('explains AlreadyConverted and refreshes the list', async () => {
    const store = setup();
    await store.load();
    service.markLost.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'FormParticipant.AlreadyConverted', message: 'Already converted.' },
          }),
      ),
    );

    expect(await store.markLost('participant-1', null)).toBe(false);

    expect(store.actionError()).toBe('This prospect is already a client. The list was refreshed.');
    expect(service.list).toHaveBeenCalledTimes(2);
    store.dismissActionError();
    expect(store.actionError()).toBeNull();
  });

  it('starts the client creation on the request the server picked', async () => {
    const store = setup();
    await store.load();
    requests.startCustomerCreation.mockReturnValue(of({ id: 'run-1' }));

    expect(await store.createClient(prospect({ canCreateClient: true, createClientRequestId: 'request-7' }))).toBe(
      true,
    );

    expect(requests.startCustomerCreation).toHaveBeenCalledWith('request-7');
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('does not start the client creation without that request and reports failures', async () => {
    const store = setup();
    expect(await store.createClient(prospect())).toBe(false);
    expect(requests.startCustomerCreation).not.toHaveBeenCalled();

    requests.startCustomerCreation.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'X', message: 'Not allowed.' } })),
    );
    expect(await store.createClient(prospect({ canCreateClient: true }))).toBe(false);
    expect(store.actionError()).toBe('Not allowed.');
  });
});
