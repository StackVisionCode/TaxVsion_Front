import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingsService } from '../../data-access/meetings.service';
import { MeetingFormValue, MeetingItem } from '../../data-access/meeting.model';
import { MeetingSchedulePanelComponent } from './meeting-schedule-panel.component';

const SCHEDULED: MeetingItem = {
  id: 'm1',
  title: 'Tax review',
  shortCode: 'ABCDEFGH',
  apiStatus: 'Scheduled',
  status: 'upcoming',
  scheduledAt: null,
  startedAt: null,
  endedAt: null,
  durationMinutes: null,
  endReasonLabel: null,
  joinedCount: 0,
  transcriptFileId: null,
  transcriptLanguage: null,
  hostUserId: 'host',
  isHost: true,
};

function render(meeting: MeetingItem | null, setTranscriptLanguage = vi.fn(() => of({ transcriptLanguage: 'es' }))) {
  const store = { setTranscriptLanguage, listInvitations: vi.fn(() => of([])), searchInvitees: vi.fn() };
  const service = { limits: vi.fn(() => of({ defaultDurationMinutes: 60, maxDurationMinutes: 120 })) };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeetingsStore, useValue: store },
      { provide: MeetingsService, useValue: service },
    ],
  });
  const fixture = TestBed.createComponent(MeetingSchedulePanelComponent);
  fixture.componentRef.setInput('meeting', meeting);
  fixture.componentRef.setInput('isOpen', true);
  fixture.detectChanges();
  fixture.detectChanges();
  // app-modal se porta al <body>.
  const select = () => document.body.querySelector('[data-role="meeting-transcript-language"]') as HTMLSelectElement;
  return { fixture, component: fixture.componentInstance, store, select };
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('MeetingSchedulePanelComponent — idioma del transcript', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="dialog"]').forEach(n => n.parentElement?.remove());
  });

  it('al crear ofrece Automatic, English y Spanish y manda el elegido', () => {
    const { component, select, store } = render(null);
    expect(Array.from(select().options).map(o => o.textContent?.trim())).toEqual(['Automatic', 'English', 'Spanish']);

    const emitted: MeetingFormValue[] = [];
    component.createRequested.subscribe(value => emitted.push(value));
    component.title.set('Tax review');
    choose(select(), 'es');
    component.save();

    expect(emitted[0]?.transcriptLanguage).toBe('es');
    // Al crear no se guarda aparte: viaja con el POST.
    expect(store.setTranscriptLanguage).not.toHaveBeenCalled();
  });

  it('por defecto es automático (null)', () => {
    const { component } = render(null);
    const emitted: MeetingFormValue[] = [];
    component.createRequested.subscribe(value => emitted.push(value));
    component.title.set('Tax review');
    component.save();
    expect(emitted[0]?.transcriptLanguage).toBeNull();
  });

  it('al gestionar muestra el idioma guardado y lo cambia en el acto', () => {
    const { component, select, store, fixture } = render({ ...SCHEDULED, transcriptLanguage: 'en' });
    expect(select().value).toBe('en');

    choose(select(), 'es');
    fixture.detectChanges();

    expect(store.setTranscriptLanguage).toHaveBeenCalledWith('m1', 'es');
    expect(component.transcriptLanguage()).toBe('es');
    expect(component.languageStatus()).toBe('saved');
  });

  it('si no se puede guardar, vuelve al idioma anterior y lo dice', () => {
    const failing = vi.fn(() => throwError(() => new Error('boom')));
    const { component, select, fixture } = render({ ...SCHEDULED, transcriptLanguage: 'en' }, failing);

    choose(select(), '');
    fixture.detectChanges();

    expect(failing).toHaveBeenCalledWith('m1', null);
    expect(component.transcriptLanguage()).toBe('en');
    expect(document.body.textContent).toContain('Could not save the language.');
  });
});
