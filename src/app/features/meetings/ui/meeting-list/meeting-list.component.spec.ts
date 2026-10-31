import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { MeetingItem } from '../../data-access/meeting.model';
import { MeetingListComponent } from './meeting-list.component';

function meeting(overrides: Partial<MeetingItem>): MeetingItem {
  return {
    id: 'm1',
    title: 'Review',
    shortCode: 'ABCDEFGH',
    apiStatus: 'Ended',
    status: 'ended',
    scheduledAt: null,
    startedAt: '2026-10-30T15:00:00Z',
    endedAt: '2026-10-30T15:30:00Z',
    durationMinutes: 30,
    endReasonLabel: null,
    joinedCount: 2,
    transcriptFileId: null,
    recordingState: null,
    hostUserId: 'host',
    isHost: false,
    ...overrides,
  };
}

function render(meetings: MeetingItem[]) {
  const fixture = TestBed.createComponent(MeetingListComponent);
  fixture.componentRef.setInput('meetings', meetings);
  fixture.detectChanges();
  const component = fixture.componentInstance;
  const details: string[] = [];
  const manage: string[] = [];
  component.details.subscribe(m => details.push(m.id));
  component.manage.subscribe(m => manage.push(m.id));
  const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.rounded-2xl.border')];
  return { rows, details, manage };
}

describe('MeetingListComponent — ficha y gestión', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('una reunión terminada abre su ficha; una agendada del host abre Manage', () => {
    const { rows, details, manage } = render([
      meeting({ id: 'past' }),
      meeting({ id: 'next', apiStatus: 'Scheduled', status: 'upcoming', startedAt: null, endedAt: null, isHost: true }),
    ]);
    rows[0].click();
    rows[1].click();
    expect(details).toEqual(['past']);
    expect(manage).toEqual(['next']);
  });

  it('una reunión cancelada (nunca empezó) no abre nada', () => {
    const { rows, details, manage } = render([meeting({ apiStatus: 'Cancelled', status: 'cancelled', startedAt: null })]);
    rows[0].click();
    expect(details).toEqual([]);
    expect(manage).toEqual([]);
  });

  it('una reunión instantánea terminada muestra cuándo se hizo, no "Not scheduled"', () => {
    const { rows } = render([meeting({})]);
    expect(rows[0].textContent).not.toContain('Not scheduled');
  });
});
