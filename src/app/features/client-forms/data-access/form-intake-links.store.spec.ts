import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { intakeLinkResponse } from '../testing/intake-link.fixture';
import { signal } from '@angular/core';
import { ClientFormsAvailabilityStore } from './client-forms-availability.store';
import { FormIntakeLinksService } from './form-intake-links.service';
import { FormIntakeLinksStore } from './form-intake-links.store';
import { FormRequestsService } from './form-requests.service';
import { FormTemplatesService } from './form-templates.service';

describe('FormIntakeLinksStore', () => {
  const links = {
    list: vi.fn(),
    token: vi.fn(),
    create: vi.fn(),
    change: vi.fn(),
    pinVersion: vi.fn(),
  };
  const requests = {
    assignableTemplates: vi.fn(() =>
      of([
        {
          templateId: 'template-1',
          name: 'Organizer',
          purpose: 'clientIntake',
          latestVersionNumber: 2,
          title: 'Organizer',
        },
      ]),
    ),
    entryNotices: vi.fn(() =>
      of([
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
      ]),
    ),
    activeStaff: vi.fn(() =>
      of([{ userId: 'user-1', name: 'Rita Reviewer', email: 'rita@example.com', isActive: true }]),
    ),
  };
  const templates = {
    versions: vi.fn(() =>
      of([
        { id: 'version-1', versionNumber: 1, title: 'Organizer', componentCount: 4, publishedAtUtc: '', publishedByUserId: '' },
        { id: 'version-2', versionNumber: 2, title: 'Organizer', componentCount: 5, publishedAtUtc: '', publishedByUserId: '' },
      ]),
    ),
  };

  const intakeEnabled = signal(true);

  function setup(): FormIntakeLinksStore {
    TestBed.configureTestingModule({
      providers: [
        FormIntakeLinksStore,
        { provide: FormIntakeLinksService, useValue: links },
        { provide: FormRequestsService, useValue: requests },
        { provide: FormTemplatesService, useValue: templates },
        { provide: ClientFormsAvailabilityStore, useValue: { intakeLinksEnabled: intakeEnabled.asReadonly() } },
      ],
    });
    return TestBed.inject(FormIntakeLinksStore);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    links.list.mockReturnValue(of([intakeLinkResponse()]));
    intakeEnabled.set(true);
  });

  it('tells a blocked transition apart from intake links being turned off', async () => {
    const unavailable = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'FormIntakeLink.Unavailable', message: 'The intake link is not available.' },
          }),
      );
    links.change.mockImplementation(unavailable);
    const store = setup();
    await store.load();

    await store.change(store.links()[0], 'resume');
    expect(store.actionError()).toContain('It may be expired');

    intakeEnabled.set(false);
    await store.change(store.links()[0], 'resume');
    expect(store.actionError()).toContain('Turnstile');
  });

  it('loads links with readable template, version, notice and responsible names', async () => {
    const store = setup();
    await store.load();

    const link = store.links()[0];
    expect(store.templateName(link.formTemplateId)).toBe('Organizer');
    expect(store.versionNumber(link)).toBe(2);
    expect(store.noticeTitle(link.entryNoticeId)).toBe('Identity verification');
    expect(store.responsibleName(link.responsibleUserId)).toBe('Rita Reviewer');
    expect(requests.entryNotices).toHaveBeenCalled();
    expect(store.entryNotices().map((notice) => notice.key)).toEqual(['identity_notice']);
  });

  it('keeps the full link only in memory and never in storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    links.token.mockReturnValue(of({ link: intakeLinkResponse(), token: 'raw-token' }));
    const store = setup();
    await store.load();

    const url = await store.reveal(store.links()[0]);

    expect(url).toBe(`${window.location.origin}/intake/raw-token`);
    expect(store.revealed()).toEqual({ linkId: 'link-1', url });
    expect(setItem).not.toHaveBeenCalled();
    store.clearRevealed();
    expect(store.revealed()).toBeNull();
    setItem.mockRestore();
  });

  it('adds a created link to the top and reveals its new link', async () => {
    links.create.mockReturnValue(
      of({ link: intakeLinkResponse({ id: 'link-2', name: 'Fair' }), token: 'fresh' }),
    );
    const store = setup();
    await store.load();

    const ok = await store.create({
      name: 'Fair',
      formTemplateId: 'template-1',
      formTemplateVersionId: null,
      entryNoticeKey: 'identity_notice',
      expiresAtUtc: null,
      maxSubmissions: null,
      responsibleUserId: 'user-1',
    });

    expect(ok).toBe(true);
    expect(store.links().map((link) => link.id)).toEqual(['link-2', 'link-1']);
    expect(store.revealed()?.url).toContain('/intake/fresh');
  });

  it('replaces the link after an action with the row version from the response', async () => {
    links.change.mockReturnValue(
      of({ link: intakeLinkResponse({ status: 'Paused', rowVersion: 'next' }), token: null }),
    );
    const store = setup();
    await store.load();

    await store.change(store.links()[0], 'pause');

    expect(links.change).toHaveBeenCalledWith('link-1', 'pause', 'AAAAAAAAB9E=');
    expect(store.links()[0]).toMatchObject({ status: 'Paused', rowVersion: 'next' });
    expect(store.revealed()).toBeNull();
  });

  it('reloads the list after a concurrency conflict so the next try uses the current row version', async () => {
    links.change.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'FormIntakeLink.ConcurrencyConflict',
              message: 'The intake link was modified by someone else.',
            },
          }),
      ),
    );
    const store = setup();
    await store.load();
    links.list.mockReturnValue(of([intakeLinkResponse({ rowVersion: 'fresh-rv' })]));

    const ok = await store.change(store.links()[0], 'revoke');

    expect(ok).toBe(false);
    expect(store.actionError()).toContain('Someone else changed this link');
    expect(store.links()[0].rowVersion).toBe('fresh-rv');
  });

  it('treats an Unavailable list (intake links off on an older backend) as empty, without an error', async () => {
    links.list.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'FormIntakeLink.Unavailable', message: 'The intake link is not available.' },
          }),
      ),
    );
    const store = setup();
    await store.load();

    expect(store.links()).toEqual([]);
    expect(store.error()).toBeNull();
  });

  it('flags forbidden template versions instead of pretending there are none', async () => {
    templates.versions.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    const store = setup();
    await store.load();

    expect(store.versionsForbidden()).toBe(true);
    expect(store.versionNumber(store.links()[0])).toBeNull();
  });
});
