import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatDirectoryService } from './chat-directory.service';
import { ChatService } from './chat.service';
import { ChatSocketService } from './chat-socket.service';
import { CustomerDirectoryEntry } from './chat.model';
import { ChatStore } from './chat.store';

const customer = (displayName: string): CustomerDirectoryEntry => ({
  customerId: displayName,
  displayName,
  email: `${displayName}@example.com`,
  isActive: true,
  portalUserId: null,
});

describe('ChatStore — búsqueda de directorio', () => {
  let store: ChatStore;
  let responses: Record<string, Subject<CustomerDirectoryEntry[]>>;

  beforeEach(() => {
    responses = {};
    const directory = {
      searchCustomers: vi.fn((term: string) => (responses[term] = new Subject<CustomerDirectoryEntry[]>())),
      searchEmployees: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatDirectoryService, useValue: directory },
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        { provide: ChatService, useValue: {} },
        { provide: ChatSocketService, useValue: {} },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: CloudStorageUploadService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    });
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('una respuesta vieja que llega tarde no pisa los resultados del texto actual', () => {
    store.searchCustomers('mina');
    store.searchCustomers('minat');

    responses['minat'].next([customer('Minato')]);
    responses['mina'].next([customer('Minaya'), customer('Minato')]);

    expect(store.customerResults().map(c => c.displayName)).toEqual(['Minato']);
    expect(store.employeeSearchLoading()).toBe(false);
  });

  it('borrar el texto cancela la búsqueda en vuelo', () => {
    store.searchCustomers('mina');
    store.searchCustomers('');

    responses['mina'].next([customer('Minato')]);

    expect(store.customerResults()).toEqual([]);
    expect(store.employeeSearchLoading()).toBe(false);
  });
});
