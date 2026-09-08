import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { MailStore, ComposeSendPayload } from './mail.store';
import { MailService } from './mail.service';
import { MailSocketService } from './mail-socket.service';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { AutoSaveDraftRequest, PagedResult } from './mail.model';

/** Página vacía con la forma completa de `PagedResult`. */
const emptyPage = <T>(): PagedResult<T> => ({
  items: [],
  page: 1,
  size: 20,
  totalCount: 0,
  totalPages: 0,
  hasMore: false,
  hasPrevious: false,
});

/**
 * El envío es lo que cierra la migración de `body` a `bodyHtml`/`bodyText`: comprueba que
 * los DOS cuerpos llegan al PATCH del draft con el nombre que espera Correspondence
 * (`htmlBody`/`textBody`), y no solo uno.
 */
describe('MailStore.sendCompose', () => {
  let autoSaved: Array<{ draftId: string; body: AutoSaveDraftRequest }>;
  let sent: string[];
  /** Orden real de las llamadas, para poder afirmar la secuencia y no solo el conteo. */
  let calls: string[];

  const payload = (over: Partial<ComposeSendPayload> = {}): ComposeSendPayload => ({
    customerId: 'c1',
    accountId: 'a1',
    to: 'uno@cli.com',
    cc: '',
    subject: '  Cierre de marzo  ',
    bodyHtml: '<div>Hola <b>Ana</b></div>',
    bodyText: 'Hola Ana',
    files: [],
    removedFileIds: [],
    ...over,
  });

  beforeEach(() => {
    autoSaved = [];
    sent = [];
    calls = [];

    const service: Partial<MailService> = {
      createDraft: vi.fn(() => {
        calls.push('create');
        return of({ draftId: 'd1' });
      }),
      autoSaveDraft: vi.fn((draftId: string, body: AutoSaveDraftRequest) => {
        calls.push('autosave');
        autoSaved.push({ draftId, body });
        return of(void 0);
      }),
      sendDraft: vi.fn((draftId: string) => {
        calls.push('send');
        sent.push(draftId);
        return of({ sentMessageId: 'm1', providerMessageId: 'p1' });
      }),
      listDrafts: vi.fn(() => of(emptyPage<never>())),
      listThreads: vi.fn(() => of(emptyPage<never>())),
      removeDraftAttachment: vi.fn(() => of(void 0)),
    };

    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: service },
        { provide: MailSocketService, useValue: { connect: vi.fn(), on: vi.fn(() => of()) } },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: CloudStorageUploadService, useValue: {} },
      ],
    });
  });

  it('manda html y texto por separado, con los nombres del backend', () => {
    TestBed.inject(MailStore).sendCompose(payload());

    expect(autoSaved).toHaveLength(1);
    expect(autoSaved[0].body.htmlBody).toBe('<div>Hola <b>Ana</b></div>');
    expect(autoSaved[0].body.textBody).toBe('Hola Ana');
  });

  it('crea, autoguarda y RECIÉN entonces envía', () => {
    // El orden importa: si la cadena enviara antes de autoguardar, un fallo posterior
    // dejaría en Drafts un correo vacío en vez del que se escribió.
    TestBed.inject(MailStore).sendCompose(payload());

    expect(calls).toEqual(['create', 'autosave', 'send']);
    expect(sent).toEqual(['d1']);
  });

  it('recorta el asunto pero NO toca los cuerpos: el html es significativo', () => {
    TestBed.inject(MailStore).sendCompose(payload({ bodyHtml: '<p> hola </p>', bodyText: ' hola ' }));

    expect(autoSaved[0].body.subject).toBe('Cierre de marzo');
    expect(autoSaved[0].body.htmlBody).toBe('<p> hola </p>');
    expect(autoSaved[0].body.textBody).toBe(' hola ');
  });

  it('un cuerpo vacío sigue viajando como cadena, no como undefined', () => {
    // SendDraft exige HtmlBody presente; mandar undefined lo rechazaría el backend.
    TestBed.inject(MailStore).sendCompose(payload({ bodyHtml: '', bodyText: '' }));

    expect(autoSaved[0].body.htmlBody).toBe('');
    expect(autoSaved[0].body.textBody).toBe('');
  });
});
