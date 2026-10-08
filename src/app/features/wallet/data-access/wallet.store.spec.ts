import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { WalletService } from './wallet.service';
import { WalletStore } from './wallet.store';
import { LedgerEntryView, PagedResult } from './wallet.model';

describe('WalletStore transaction pagination', () => {
  let store: WalletStore;
  let requests: { page: number; size: number; response: Subject<PagedResult<LedgerEntryView>> }[];
  const result = (page: number, totalCount = 24): PagedResult<LedgerEntryView> => ({
    items: [], page, size: 10, totalCount, totalPages: Math.ceil(totalCount / 10),
    hasMore: page * 10 < totalCount, hasPrevious: page > 1,
  });

  beforeEach(() => {
    requests = [];
    TestBed.configureTestingModule({ providers: [
      WalletStore,
      { provide: CommunicationRealtimeService, useValue: {} },
      { provide: WalletService, useValue: {
        listTransactions: (page: number, size: number) => {
          const response = new Subject<PagedResult<LedgerEntryView>>();
          requests.push({ page, size, response });
          return response.asObservable();
        },
      } },
    ] });
    store = TestBed.inject(WalletStore);
  });

  it('requests a page and retains it when refreshing', () => {
    store.loadTransactions(2);
    expect(requests[0].page).toBe(2);
    expect(requests[0].size).toBe(10);
    expect(store.txLoading()).toBe(true);
    requests[0].response.next(result(2));
    expect(store.txPage()).toBe(2);
    expect(store.txTotal()).toBe(24);
    expect(store.txLoading()).toBe(false);
    store.loadTransactions();
    expect(requests[1].page).toBe(2);
  });

  it('ignores late responses from an earlier request', () => {
    store.loadTransactions(1);
    store.loadTransactions(2);
    requests[1].response.next(result(2));
    requests[0].response.next(result(1));
    expect(store.txPage()).toBe(2);
  });

  it('returns to the last available page when the total shrinks', () => {
    store.loadTransactions(3);
    requests[0].response.next(result(3, 12));
    expect(requests[1].page).toBe(2);
    requests[1].response.next(result(2, 12));
    expect(store.txPage()).toBe(2);
    expect(store.txLoading()).toBe(false);
  });

  it('clears loading on failure without advancing the current page', () => {
    store.loadTransactions(2);
    requests[0].response.error(new Error('Unavailable'));
    expect(store.txLoading()).toBe(false);
    expect(store.txError()).toBeTruthy();
    expect(store.txPage()).toBe(1);
  });
});
