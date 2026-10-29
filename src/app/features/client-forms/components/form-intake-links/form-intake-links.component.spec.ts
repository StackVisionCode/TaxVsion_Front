import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import type {
  ActiveConsentNotice,
  FormIntakeLink,
  StaffMemberOption,
} from '../../data-access/client-forms.model';
import { ClientFormsAvailabilityStore } from '../../data-access/client-forms-availability.store';
import { FormIntakeLinksStore, type RevealedIntakeLink } from '../../data-access/form-intake-links.store';
import { intakeLinkResponse } from '../../testing/intake-link.fixture';
import { FormIntakeLinksService } from '../../data-access/form-intake-links.service';
import { FormRequestsService } from '../../data-access/form-requests.service';
import { FormTemplatesService } from '../../data-access/form-templates.service';
import { of, throwError } from 'rxjs';
import { FormIntakeLinksComponent } from './form-intake-links.component';

describe('FormIntakeLinksComponent', () => {
  const enabled = signal(true);
  const state = {
    links: signal<FormIntakeLink[]>([]),
    revealed: signal<RevealedIntakeLink | null>(null),
    actionError: signal<string | null>(null),
    notices: signal<ActiveConsentNotice[]>([]),
    staff: signal<StaffMemberOption[]>([]),
  };
  const store = {
    links: state.links.asReadonly(),
    revealed: state.revealed.asReadonly(),
    actionError: state.actionError.asReadonly(),
    entryNotices: state.notices.asReadonly(),
    staff: state.staff.asReadonly(),
    templates: () => [
      { templateId: 'template-1', name: 'Organizer', purpose: 'clientIntake', latestVersionNumber: 2, title: 'Organizer' },
    ],
    loading: () => false,
    error: () => null,
    busyId: () => null,
    noticesFailed: () => false,
    versionsForbidden: signal(false),
    load: vi.fn(async () => undefined),
    loadVersions: vi.fn(async () => []),
    templateName: () => 'Organizer',
    versionNumber: () => 2,
    noticeTitle: () => 'Identity verification',
    responsibleName: () => 'Rita Reviewer',
    create: vi.fn(async () => true),
    change: vi.fn(async () => true),
    pinVersion: vi.fn(async () => true),
    reveal: vi.fn(async () => null),
    clearRevealed: vi.fn(() => state.revealed.set(null)),
    dismissActionError: vi.fn(() => state.actionError.set(null)),
  };
  const toast = { success: vi.fn(), error: vi.fn() };
  const clipboard = { copy: vi.fn(async () => true) };

  beforeEach(() => {
    vi.clearAllMocks();
    enabled.set(true);
    store.versionsForbidden.set(false);
    state.links.set([intakeLinkResponse()]);
    state.revealed.set(null);
    state.actionError.set(null);
    state.notices.set([
      {
        id: 'notice-1',
        key: 'identity_notice',
        title: 'Identity verification',
        purpose: 'IdentityVerification',
        versionNumber: 2,
        language: 'en',
        textSnapshot: 'We collect your email to verify your identity.',
        contentHash: 'hash-1',
        publishedAtUtc: '2026-10-01T00:00:00',
      },
    ]);
    state.staff.set([
      { userId: 'user-1', name: 'Rita Reviewer', email: 'rita@example.com', isActive: true },
    ]);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClientFormsAvailabilityStore, useValue: { intakeLinksEnabled: enabled.asReadonly() } },
        { provide: ToastService, useValue: toast },
        { provide: ClipboardService, useValue: clipboard },
      ],
    });
    // El componente provee su propio store: se reemplaza a nivel de componente.
    TestBed.overrideComponent(FormIntakeLinksComponent, {
      set: { providers: [{ provide: FormIntakeLinksStore, useValue: store }] },
    });
  });

  function render() {
    const fixture = TestBed.createComponent(FormIntakeLinksComponent);
    fixture.detectChanges();
    return fixture;
  }

  function openMenu(fixture: ReturnType<typeof render>): string[] {
    (fixture.nativeElement.querySelector('app-dropdown-menu button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // El panel del menú se porta al <body>: se busca en el documento.
    return Array.from(document.querySelectorAll('[role="menu"] button')).map(
      (button) => (button as HTMLElement).textContent?.trim() ?? '',
    );
  }

  it('lists the link with template, version, responsible, quota and status', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent as string;

    expect(store.load).toHaveBeenCalled();
    expect(text).toContain('Website intake');
    expect(text).toContain('Organizer');
    expect(text).toContain('Version 2');
    expect(text).toContain('Rita Reviewer');
    expect(text).toContain('3 / 50');
    expect(text).toContain('Never');
    expect(text).toContain('Active');
    fixture.destroy();
  });

  it('offers every action on an active link while intake links are on', () => {
    const fixture = render();
    expect(openMenu(fixture)).toEqual([
      'Copy link',
      'Pause',
      'Change version',
      'Regenerate link',
      'Revoke',
    ]);
    fixture.destroy();
  });

  it('replaces the version picker with a notice when template versions are forbidden', () => {
    store.versionsForbidden.set(true);
    const fixture = render();
    fixture.componentInstance.openCreate();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="versions-forbidden"]')?.textContent).toContain(
      "You can't see template versions; the link uses the latest version.",
    );
    expect(document.querySelector('#intake-version')).toBeNull();
    expect(openMenu(fixture)).not.toContain('Change version');
    fixture.destroy();
  });

  // El id va al <select> (input del control), no se duplica en el host.
  it('puts the label target id only on the select element', () => {
    const fixture = render();
    fixture.componentInstance.openCreate();
    fixture.detectChanges();

    const matches = document.querySelectorAll('#intake-template');
    expect(matches.length).toBe(1);
    expect(matches[0].tagName).toBe('SELECT');
    expect(document.querySelector('label[for="intake-template"]')).not.toBeNull();
    fixture.destroy();
  });

  it('explains the Turnstile requirement, disables create and keeps pause and revoke when off', () => {
    enabled.set(false);
    const fixture = render();

    expect(fixture.nativeElement.querySelector('[data-testid="intake-links-off"]')?.textContent).toContain(
      'They need bot protection (Turnstile) to be configured first.',
    );
    expect(
      (fixture.nativeElement.querySelector('[data-testid="new-intake-link"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(openMenu(fixture)).toEqual(['Pause', 'Revoke']);
    fixture.destroy();
  });

  it('asks before revoking and calls the store only after confirming', async () => {
    const fixture = render();
    const component = fixture.componentInstance;
    const link = state.links()[0];

    component.askConfirm(link, 'revoke');
    expect(store.change).not.toHaveBeenCalled();
    await component.confirm();

    expect(store.change).toHaveBeenCalledWith(link, 'revoke');
    expect(component.confirmTarget()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Intake link revoked');
    fixture.destroy();
  });

  it('regenerates the token after confirming', async () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.askConfirm(state.links()[0], 'regenerate');
    await component.confirm();

    expect(store.change).toHaveBeenCalledWith(state.links()[0], 'regenerate-token');
    fixture.destroy();
  });

  it('creates a link with the CreateFormIntakeLinkRequest fields', async () => {
    const fixture = render();
    const component = fixture.componentInstance;

    component.openCreate();
    component.name.set(' Website intake ');
    await component.selectTemplate('template-1');
    component.responsibleId.set('user-1');
    component.maxSubmissions.set('25');
    component.expiresOn.set('2026-12-31');
    expect(component.createReady()).toBe(true);
    await component.create(new Event('submit'));

    expect(store.create).toHaveBeenCalledWith({
      name: 'Website intake',
      formTemplateId: 'template-1',
      formTemplateVersionId: null,
      entryNoticeKey: 'identity_notice',
      expiresAtUtc: '2026-12-31T23:59:59Z',
      maxSubmissions: 25,
      responsibleUserId: 'user-1',
    });
    expect(component.createOpen()).toBe(false);
    fixture.destroy();
  });

  it('rejects a submission limit that is not a positive whole number', () => {
    const fixture = render();
    const component = fixture.componentInstance;
    component.openCreate();
    component.name.set('Fair');
    component.templateId.set('template-1');
    component.responsibleId.set('user-1');

    component.maxSubmissions.set('0');
    expect(component.createReady()).toBe(false);
    component.maxSubmissions.set('2.5');
    expect(component.createReady()).toBe(false);
    component.maxSubmissions.set('');
    expect(component.createReady()).toBe(true);
    fixture.destroy();
  });

  it('copies the revealed link and forgets it when the tab closes', async () => {
    const fixture = render();
    const component = fixture.componentInstance;
    state.revealed.set({ linkId: 'link-1', url: 'https://office.test/intake/raw' });
    fixture.detectChanges();

    await component.copyRevealed();
    expect(clipboard.copy).toHaveBeenCalledWith('https://office.test/intake/raw');
    expect(toast.success).toHaveBeenCalledWith('Link copied');

    fixture.destroy();
    expect(store.clearRevealed).toHaveBeenCalled();
  });
});

/** Con el store real y la respuesta real del backend (sin mockear el store). */
describe('FormIntakeLinksComponent with intake links turned off', () => {
  const list = vi.fn();

  beforeEach(() => {
    list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClientFormsAvailabilityStore, useValue: { intakeLinksEnabled: signal(false).asReadonly() } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: ClipboardService, useValue: { copy: vi.fn() } },
        { provide: FormIntakeLinksService, useValue: { list } },
        {
          provide: FormRequestsService,
          useValue: {
            assignableTemplates: () => of([]),
            entryNotices: () => of([]),
            activeStaff: () => of([]),
          },
        },
        { provide: FormTemplatesService, useValue: { versions: () => of([]) } },
      ],
    });
  });

  // Espera a que el store real termine de cargar (lista + catálogos).
  async function render() {
    const fixture = TestBed.createComponent(FormIntakeLinksComponent);
    fixture.detectChanges();
    const store = fixture.debugElement.injector.get(FormIntakeLinksStore);
    await vi.waitFor(() => expect(store.loading()).toBe(false));
    fixture.detectChanges();
    return fixture;
  }

  it('shows the banner and the existing links with only Pause and Revoke', async () => {
    // GET tasks/forms/intake-links responde la lista aunque el sub-flag esté apagado.
    list.mockReturnValue(of([intakeLinkResponse(), intakeLinkResponse({ id: 'link-2', status: 'Paused' })]));
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="intake-links-off"]')).not.toBeNull();
    expect(element.querySelectorAll('tbody tr').length).toBe(2);
    (element.querySelector('app-dropdown-menu button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(document.querySelectorAll('[role="menu"] button')).map(
      (button) => button.textContent?.trim(),
    );
    expect(items).toEqual(['Pause', 'Revoke']);
    fixture.destroy();
  });

  it('shows only the banner, without an error and Retry, when the list answers Unavailable', async () => {
    list.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'FormIntakeLink.Unavailable', message: 'The intake link is not available.' },
          }),
      ),
    );
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="intake-links-off"]')).not.toBeNull();
    expect(element.textContent).not.toContain('Retry');
    expect(element.textContent).not.toContain('The intake link is not available.');
    fixture.destroy();
  });
});
