import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { PublicFormSessionStorageService } from '../../data-access/public-form-session-storage.service';
import type {
  DraftSaveResponse,
  PublicFormRequest,
  StoredPublicFormSession,
} from '../../data-access/public-forms.model';
import { PublicFormsService } from '../../data-access/public-forms.service';
import { PublicFormPageComponent } from './public-form-page.component';

const definition: FormDefinition = {
  schemaVersion: 1,
  title: 'Client intake',
  purpose: 'clientIntake',
  presentation: 'wizard',
  pages: [
    {
      id: 'page1',
      title: 'About you',
      sections: [
        {
          id: 'section1',
          components: [
            { id: 'name', type: 'text', label: 'Full name' },
            { id: 'home', type: 'address', label: 'Home address' },
          ],
        },
      ],
    },
    {
      id: 'page2',
      title: 'Income',
      sections: [{ id: 'section2', components: [{ id: 'job', type: 'text', label: 'Job' }] }],
    },
  ],
};

const address = (city: string) => ({ line1: '1 Main St', city, state: 'NY', postalCode: '10001' });

function request(values: Record<string, unknown>, rowVersion = 'rv-1'): PublicFormRequest {
  return {
    id: 'request-1',
    title: 'Client intake',
    messageToClient: null,
    status: 'Pending',
    readOnly: false,
    dueAtUtc: null,
    taxYear: null,
    definition,
    answers: { schemaVersion: 1, values },
    rowVersion,
    attachments: [],
    consents: [],
    review: null,
  };
}

function saved(rowVersion: string): Observable<DraftSaveResponse> {
  return of({ saved: true, rowVersion, savedAtUtc: null, progress: null, issues: [] });
}

/** BroadcastChannel en memoria: permite simular otra pestaña. */
class FakeChannel {
  static open: FakeChannel[] = [];
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }
  postMessage(): void {
    // Los mensajes propios no vuelven a la misma pestaña.
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }
  close(): void {
    FakeChannel.open = FakeChannel.open.filter((channel) => channel !== this);
  }
  receive(data: unknown): void {
    for (const listener of this.listeners) listener({ data } as MessageEvent<unknown>);
  }
}

describe('PublicFormPageComponent', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let stored: StoredPublicFormSession | null;

  beforeEach(() => {
    FakeChannel.open = [];
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    stored = { sessionToken: 'session-1', expiresAtUtc: '2099-01-01T00:00:00', requestId: 'request-1' };
    service = {
      getAccess: vi.fn(() =>
        of({
          title: 'Client intake',
          tenantBrandingKey: 'acme',
          maskedEmail: 'a***@example.com',
          entryNotice: { title: 'Welcome', language: 'En', body: null, contentHash: 'h' },
        }),
      ),
      getRequest: vi.fn(() => of(request({ name: 'Ana', home: address('Albany') }))),
      saveDraft: vi.fn(() => saved('rv-2')),
      saveDraftKeepalive: vi.fn(),
      requestChallenge: vi.fn(() => of(undefined)),
      verify: vi.fn(() =>
        of({ sessionToken: 'session-2', expiresAtUtc: '2099-01-01T00:00:00', requestId: 'request-1' }),
      ),
      logout: vi.fn(() => of(undefined)),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
  });

  function providers() {
    return [
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data: { kind: 'directed' }, paramMap: { get: () => 'token-1' } } },
      },
      { provide: PublicFormsService, useValue: service },
      {
        provide: PublicFormSessionStorageService,
        useValue: {
          read: () => stored,
          write: (_kind: string, _token: string, session: StoredPublicFormSession) => {
            stored = session;
          },
          clear: () => {
            stored = null;
          },
        },
      },
      {
        provide: TenantBrandingService,
        useValue: { logoUrl: signal(null), applyForPublicBrandingKey: vi.fn() },
      },
    ];
  }

  async function setup(): Promise<ComponentFixture<PublicFormPageComponent>> {
    TestBed.configureTestingModule({
      imports: [PublicFormPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { kind: 'directed' }, paramMap: { get: () => 'token-1' } } },
        },
        { provide: PublicFormsService, useValue: service },
        {
          provide: PublicFormSessionStorageService,
          useValue: {
            read: () => stored,
            write: (_kind: string, _token: string, session: StoredPublicFormSession) => {
              stored = session;
            },
            clear: () => {
              stored = null;
            },
          },
        },
        {
          provide: TenantBrandingService,
          useValue: { logoUrl: signal(null), applyForPublicBrandingKey: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(PublicFormPageComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.componentInstance.step()).toBe('form');
    return fixture;
  }

  async function settle(fixture: ComponentFixture<PublicFormPageComponent>): Promise<void> {
    for (let index = 0; index < 5; index++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    }
  }

  function button(root: ParentNode, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === text,
    );
    if (!found) throw new Error(`Button '${text}' not found`);
    return found as HTMLButtonElement;
  }

  function withValues(values: Record<string, unknown>): FormAnswers {
    return { schemaVersion: 1, values };
  }

  it('shows each conflict with its label and both readable values, and saves the chosen side', async () => {
    service['saveDraft']
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })))
      .mockReturnValue(saved('rv-3'));
    const fixture = await setup();
    const page = fixture.componentInstance;
    service['getRequest'].mockReturnValue(of(request({ name: 'Ana', home: address('Buffalo') }, 'rv-2')));

    page.updateAnswers(withValues({ name: 'Ana', home: address('Queens') }));
    page.saveOnBlur();
    await settle(fixture);

    expect(page.rendererMode()).toBe('readonly');
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Choose which answers to keep');
    expect(dialog.querySelector('legend')?.textContent?.trim()).toBe('Home address');
    expect(dialog.textContent).toContain('On this device');
    expect(dialog.textContent).toContain('1 Main St, Queens, NY, 10001');
    expect(dialog.textContent).toContain('Saved from another tab or device');
    expect(dialog.textContent).toContain('1 Main St, Buffalo, NY, 10001');
    expect(button(dialog, 'Save my choices').disabled).toBe(true);

    (dialog.querySelectorAll('input[type="radio"]')[0] as HTMLInputElement).click();
    fixture.detectChanges();
    button(dialog, 'Save my choices').click();
    await settle(fixture);

    expect(service['saveDraft']).toHaveBeenLastCalledWith(
      'session-1',
      withValues({ name: 'Ana', home: address('Queens') }),
      'rv-2',
    );
    expect(page.saveState()?.status).toBe('idle');
    expect(page.rendererMode()).toBe('fill');
  });

  it('saves before moving to the next page and focuses the new heading', async () => {
    const pendingSave = new Subject<DraftSaveResponse>();
    service['saveDraft'].mockReturnValue(pendingSave);
    const fixture = await setup();
    const page = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    page.updateAnswers(withValues({ name: 'Ana María', home: address('Albany') }));
    button(root, 'Continue').click();
    await settle(fixture);

    expect(service['saveDraft']).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-dc-page-heading]')?.textContent?.trim()).toBe('About you');

    pendingSave.next({ saved: true, rowVersion: 'rv-2', savedAtUtc: null, progress: null, issues: [] });
    pendingSave.complete();
    await settle(fixture);

    const heading = root.querySelector('[data-dc-page-heading]') as HTMLElement;
    expect(heading.textContent?.trim()).toBe('Income');
    expect(document.activeElement).toBe(heading);
  });

  it('stays on the page and shows the failure when the save before navigating fails', async () => {
    service['saveDraft'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const fixture = await setup();
    const root = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.updateAnswers(withValues({ name: 'Ana María', home: address('Albany') }));
    button(root, 'Continue').click();
    await settle(fixture);

    expect(root.querySelector('[data-dc-page-heading]')?.textContent?.trim()).toBe('About you');
    expect(root.textContent).toContain('We could not save your changes');
  });

  it('turns read-only while another tab has control and gives control back on request', async () => {
    const fixture = await setup();
    const page = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    FakeChannel.open[0].receive({
      scope: 'dc-form-presence-v1',
      requestId: 'request-1',
      senderId: 'older-tab',
      openedAt: 0,
      type: 'presence',
    });
    fixture.detectChanges();

    expect(page.rendererMode()).toBe('readonly');
    expect(root.textContent).toContain('This form is open in another tab.');
    expect(() => page.updateAnswers(withValues({ name: 'Other', home: address('Albany') }))).not.toThrow();
    expect(page.answers().values['name']).toBe('Ana');
    page.saveOnBlur();
    await settle(fixture);
    expect(service['saveDraft']).not.toHaveBeenCalled();

    button(root, 'Use it here').click();
    fixture.detectChanges();
    expect(page.rendererMode()).toBe('fill');
  });

  it('asks for a new code in a modal when the session expires and keeps what was written', async () => {
    service['saveDraft']
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 401 })))
      .mockReturnValue(saved('rv-2'));
    const fixture = await setup();
    const page = fixture.componentInstance;

    page.updateAnswers(withValues({ name: 'Ana Unsaved', home: address('Albany') }));
    page.saveOnBlur();
    await settle(fixture);

    expect(page.step()).toBe('form');
    expect(page.rendererMode()).toBe('readonly');
    expect(page.answers().values['name']).toBe('Ana Unsaved');
    expect(stored).toBeNull();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Your secure session expired');
    expect(dialog.textContent).toContain('a***@example.com');

    button(dialog, 'Send a new code').click();
    await settle(fixture);
    expect(service['requestChallenge']).toHaveBeenCalledWith('directed', 'token-1', undefined, undefined, 'En');
    const codeInput = dialog.querySelector('#reauth-code') as HTMLInputElement;
    codeInput.value = '123456';
    codeInput.dispatchEvent(new Event('input'));
    button(dialog, 'Verify and continue').click();
    await settle(fixture);

    expect(page.sessionExpired()).toBe(false);
    expect(page.step()).toBe('form');
    expect(page.answers().values['name']).toBe('Ana Unsaved');
    expect(service['saveDraft']).toHaveBeenLastCalledWith(
      'session-2',
      withValues({ name: 'Ana Unsaved', home: address('Albany') }),
      'rv-1',
    );
  });

  it('sends the chosen email language when verifying a directed link', async () => {
    stored = null;
    TestBed.configureTestingModule({
      imports: [PublicFormPageComponent],
      providers: providers(),
    });
    const fixture = TestBed.createComponent(PublicFormPageComponent);
    fixture.detectChanges();
    await settle(fixture);
    const page = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    expect(page.step()).toBe('welcome');

    const spanish = root.querySelector('input[name="public-form-language"][value="Es"]') as HTMLInputElement;
    spanish.click();
    button(root, 'Send verification code').click();
    await settle(fixture);
    page.setCode('123456');
    await page.verifyCode();

    expect(service['verify']).toHaveBeenCalledWith('directed', 'token-1', '123456', undefined, 'Es');
  });
  it('shows the code limit from the challenge response after requesting a code', async () => {
    stored = null;
    service['requestChallenge'].mockReturnValue(of({ codeLimitPerHour: 3, retryAfterSeconds: 60 }));
    TestBed.configureTestingModule({ imports: [PublicFormPageComponent], providers: providers() });
    const fixture = TestBed.createComponent(PublicFormPageComponent);
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="code-limit-hint"]')).toBeNull();

    button(root, 'Send verification code').click();
    await settle(fixture);

    expect(fixture.componentInstance.step()).toBe('otp');
    expect(root.querySelector('[data-testid="code-limit-hint"]')?.textContent).toContain(
      'You can request up to 3 codes per hour.',
    );
  });

  it('falls back to 5 codes per hour when the challenge response has no body', async () => {
    stored = null;
    TestBed.configureTestingModule({ imports: [PublicFormPageComponent], providers: providers() });
    const fixture = TestBed.createComponent(PublicFormPageComponent);
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    button(root, 'Send verification code').click();
    await settle(fixture);

    expect(root.querySelector('[data-testid="code-limit-hint"]')?.textContent).toContain(
      'You can request up to 5 codes per hour. If no code arrives, wait a bit before trying again.',
    );
  });

  it('shows a final state when the intake link was already submitted by this visitor', async () => {
    stored = null;
    service['verify'].mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: 'PublicForm.AlreadySubmitted',
              message: 'You already sent this form. Your office is reviewing it.',
            },
          }),
      ),
    );
    TestBed.configureTestingModule({ imports: [PublicFormPageComponent], providers: providers() });
    const fixture = TestBed.createComponent(PublicFormPageComponent);
    fixture.detectChanges();
    await settle(fixture);
    const page = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    button(root, 'Send verification code').click();
    await settle(fixture);
    page.setCode('123456');
    await page.verifyCode();
    await settle(fixture);

    expect(page.step()).toBe('alreadySubmitted');
    expect(page.error()).toBeNull();
    const panel = root.querySelector('[data-testid="already-submitted"]');
    expect(panel?.querySelector('h1')?.textContent).toContain('You already sent this form');
    expect(panel?.textContent).toContain("Your office is reviewing it. You'll hear from them by email.");
    expect(root.querySelector('.error-message')).toBeNull();
  });

  it('keeps the generic message for other verification failures', async () => {
    stored = null;
    service['verify'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    TestBed.configureTestingModule({ imports: [PublicFormPageComponent], providers: providers() });
    const fixture = TestBed.createComponent(PublicFormPageComponent);
    fixture.detectChanges();
    await settle(fixture);
    const page = fixture.componentInstance;

    button(fixture.nativeElement as HTMLElement, 'Send verification code').click();
    await settle(fixture);
    page.setCode('123456');
    await page.verifyCode();

    expect(page.step()).toBe('otp');
    expect(page.error()).toBe('The verification code is invalid or expired.');
  });

  it('does not require a consent hidden by a condition', async () => {
    const withConsent = request({ name: 'Ana' });
    withConsent.definition = structuredClone(definition);
    withConsent.definition.pages[0].sections[0].components.push({
      id: 'privacy',
      type: 'consent',
      visibleWhen: { field: 'name', op: 'equals', value: 'Show consent' },
      props: { noticeKey: 'privacy', noticeVersionNumber: 1, mode: 'acceptance', blocking: true },
    });
    withConsent.consents = [
      {
        componentId: 'privacy',
        noticeKey: 'privacy',
        noticeVersionNumber: 1,
        mode: 'acceptance',
        timing: 'beforeCollection',
        acceptanceText: 'I agree',
        blocking: true,
        language: 'En',
        body: null,
        contentHash: 'h',
        evidence: null,
      },
    ];
    service['getRequest'].mockReturnValue(of(withConsent));

    const fixture = await setup();

    expect(fixture.componentInstance.step()).toBe('form');
    expect(fixture.componentInstance.activeConsent()).toBeNull();
  });

  it('keeps a captured tax ID when control is lost during the capture and saves it later', async () => {
    const capture = new Subject<{ sensitiveRef: string; last4: string; kind: string; rowVersion: string }>();
    service['captureSensitive'] = vi.fn(() => capture);
    const fixture = await setup();
    const page = fixture.componentInstance;
    const channel = FakeChannel.open[0];
    const presence = (type: 'presence' | 'release') =>
      channel.receive({
        scope: 'dc-form-presence-v1',
        requestId: 'request-1',
        senderId: 'older-tab',
        openedAt: 0,
        type,
      });

    const capturing = page.captureSensitive({ componentId: 'name', rowId: null, kind: 'ssn', value: '123456789' });
    await settle(fixture);
    presence('presence');
    capture.next({ sensitiveRef: 'vault/1', last4: '6789', kind: 'Ssn', rowVersion: 'rv-2' });
    capture.complete();
    await capturing;

    expect(page.error()).toBeNull();
    expect(service['saveDraft']).not.toHaveBeenCalled();

    presence('release');
    await settle(fixture);

    expect(service['saveDraft']).toHaveBeenCalledWith(
      'session-1',
      withValues({
        name: { sensitiveRef: 'vault/1', last4: '6789', kind: 'ssn' },
        home: address('Albany'),
      }),
      'rv-2',
    );
  });

  it('polls the antivirus verdict while a file is pending and stops at the time limit', async () => {
    const pending = request({ name: 'Ana', home: address('Albany') });
    pending.attachments = [
      {
        id: 'att-1',
        fileId: 'file-1',
        componentId: 'name',
        rowId: null,
        displayName: 'w2.pdf',
        status: 'Pending',
        rejectionCode: null,
      },
    ];
    service['getRequest'].mockReturnValue(of(pending));
    const fixture = await setup();
    const page = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;
    expect(page.scanPending()).toBe(true);
    expect(root.textContent).toContain('Scanning your files');

    // El sondeo arrancó con relojes reales al abrir: se reinicia con relojes simulados.
    (page as unknown as { stopScanPolling(): void }).stopScanPolling();
    vi.useFakeTimers();
    try {
      page.checkScansAgain();
      await vi.advanceTimersByTimeAsync(3_000);
      const afterFirstTick = service['getRequest'].mock.calls.length;
      expect(afterFirstTick).toBeGreaterThan(1);

      await vi.advanceTimersByTimeAsync(125_000);
      fixture.detectChanges();
      expect(page.scanStalled()).toBe(true);
      expect(root.textContent).toContain('Still scanning');
      const atLimit = service['getRequest'].mock.calls.length;
      expect(atLimit).toBeLessThanOrEqual(afterFirstTick + 41);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(service['getRequest'].mock.calls.length).toBe(atLimit);

      service['getRequest'].mockReturnValue(of({ ...pending, attachments: [{ ...pending.attachments[0], status: 'Available' }] }));
      page.checkScansAgain();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(page.scanPending()).toBe(false);

      fixture.destroy();
      const afterDestroy = service['getRequest'].mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(service['getRequest'].mock.calls.length).toBe(afterDestroy);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('accessibility', () => {
    async function open(): Promise<ComponentFixture<PublicFormPageComponent>> {
      TestBed.configureTestingModule({ imports: [PublicFormPageComponent], providers: providers() });
      const fixture = TestBed.createComponent(PublicFormPageComponent);
      fixture.detectChanges();
      await settle(fixture);
      return fixture;
    }

    it('keeps the page header and footer outside the single main landmark', async () => {
      const fixture = await setup();
      const root = fixture.nativeElement as HTMLElement;
      const main = root.querySelectorAll('main');
      expect(main.length).toBe(1);
      expect(main[0].contains(root.querySelector('a[aria-label="TaxProffice home"]'))).toBe(false);
      expect(main[0].contains(root.querySelector('.public-form-footer'))).toBe(false);
      expect(root.querySelector('.secure-label')?.hasAttribute('aria-label')).toBe(false);
      expect(root.querySelector('.secure-text')?.textContent?.trim()).toBe('Secure form');
    });

    it('labels each code box, autofills the whole code from the first box and announces the error', async () => {
      stored = null;
      const fixture = await open();
      const page = fixture.componentInstance;
      const root = fixture.nativeElement as HTMLElement;
      expect(page.step()).toBe('welcome');

      button(root, 'Send verification code').click();
      await settle(fixture);

      expect(page.step()).toBe('otp');
      expect(document.activeElement).toBe(root.querySelector('#otp-title'));
      expect(document.title).toBe('Enter your verification code - Acme');
      const boxes = Array.from(root.querySelectorAll('.otp-input')) as HTMLInputElement[];
      expect(root.querySelector('.otp-fieldset legend')?.textContent?.trim()).toBe(
        'Six-digit verification code',
      );
      expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual(
        [1, 2, 3, 4, 5, 6].map((n) => `Digit ${n} of 6`),
      );
      expect(boxes.map((box) => box.getAttribute('autocomplete'))).toEqual([
        'one-time-code',
        'off',
        'off',
        'off',
        'off',
        'off',
      ]);
      expect(boxes.every((box) => box.getAttribute('inputmode') === 'numeric')).toBe(true);

      // El teclado del móvil pega el código entero en la primera casilla.
      boxes[0].value = '123456';
      boxes[0].dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(page.code()).toBe('123456');

      page.setCode('12');
      await page.verifyCode();
      fixture.detectChanges();
      const first = root.querySelector('.otp-input') as HTMLInputElement;
      expect(first.getAttribute('aria-invalid')).toBe('true');
      expect(first.getAttribute('aria-describedby')).toBe('otp-error');
      expect(root.querySelector('#otp-error')?.getAttribute('role')).toBe('alert');
    });

    it('flags the email field as invalid only for the email error', async () => {
      const fixture = await setup();
      const page = fixture.componentInstance;
      page.error.set('Enter a valid email address.');
      expect(page.emailInvalid()).toBe(true);
      page.error.set('We could not send a verification code. Please try again.');
      expect(page.emailInvalid()).toBe(false);
    });
  });
});
