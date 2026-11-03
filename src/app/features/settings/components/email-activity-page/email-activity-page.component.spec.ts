import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ENGAGEMENT_HINT, EmailActivityItem } from '@core/postmaster/email-activity.model';
import { EmailActivityService } from '@core/postmaster/email-activity.service';
import { EmailActivityStore } from '../../data-access/email-activity.store';
import { EmailActivityPageComponent } from './email-activity-page.component';

const item = (id: string, opened: boolean, clicked: boolean): EmailActivityItem => ({
  id,
  subject: 'Your documents are ready',
  recipients: ['c***@client.com'],
  lane: 'SystemProvider',
  status: 'Delivered',
  queuedAtUtc: '2026-10-21T12:00:00',
  sentAtUtc: '2026-10-21T12:00:01',
  lastEventAtUtc: null,
  opened,
  clicked,
});

describe('EmailActivityPageComponent', () => {
  let list: ReturnType<typeof vi.fn>;

  function create() {
    list = vi.fn(() =>
      of({
        items: [item('m1', true, true), item('m2', false, false)],
        page: 1,
        size: 25,
        totalCount: 2,
      }),
    );
    TestBed.configureTestingModule({
      imports: [EmailActivityPageComponent],
      providers: [
        provideRouter([]),
        EmailActivityStore,
        { provide: EmailActivityService, useValue: { list, get: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(EmailActivityPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pinta íconos Opened y Clicked junto al estado, con el aviso de que son aproximados', () => {
    const fixture = create();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>;

    const clicked = rows[0].querySelector('span[data-engagement="Clicked"]') as HTMLElement;
    expect(rows[0].querySelector('span[data-engagement="Opened"]')).not.toBeNull();
    expect(clicked.getAttribute('aria-label')).toBe(`Clicked. ${ENGAGEMENT_HINT}`);
    expect(clicked.getAttribute('title')).toContain(ENGAGEMENT_HINT);
    expect(rows[1].querySelector('[data-engagement]')).toBeNull();
  });

  it('los filtros Opened y Clicked piden engagement= y se quitan al volver a pulsarlos', () => {
    const fixture = create();
    const button = (id: string) =>
      fixture.nativeElement.querySelector(`button[data-engagement="${id}"]`) as HTMLButtonElement;

    button('Opened').click();
    fixture.detectChanges();
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ status: 'All', engagement: 'Opened' });
    expect(button('Opened').getAttribute('aria-pressed')).toBe('true');
    expect(button('Clicked').getAttribute('aria-pressed')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-role="engagement-hint"]')?.textContent,
    ).toContain(ENGAGEMENT_HINT);

    button('Opened').click();
    fixture.detectChanges();
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ engagement: null });
    expect(button('Opened').getAttribute('aria-pressed')).toBe('false');
  });
});
