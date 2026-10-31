import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingItem, MeetingSummaryResponse } from '../../data-access/meeting.model';
import { MeetingDetailsPanelComponent } from './meeting-details-panel.component';

const MEETING: MeetingItem = {
  id: 'm1',
  title: 'Quarterly review',
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
  recordingState: 'Ready',
  hostUserId: 'host',
  isHost: true,
};

function summary(overrides: Partial<MeetingSummaryResponse> = {}): MeetingSummaryResponse {
  return {
    meeting: {
      id: 'm1',
      title: 'Quarterly review',
      description: null,
      status: 'Ended',
      shortCode: 'ABCDEFGH',
      hostUserId: 'host',
      hostName: 'Hosting Person',
      scheduledForUtc: null,
      scheduledDurationMinutes: null,
      startedAtUtc: '2026-10-30T15:00:00Z',
      endedAtUtc: '2026-10-30T15:30:00Z',
      durationSeconds: 1800,
      endReason: 'NoParticipants',
      maxParticipants: 10,
      transcriptFileId: 'tx-1',
      recordingState: 'Ready',
    },
    participants: [
      {
        userId: 'host', displayName: 'Hosting Person', avatarFileId: null, role: 'Host', actorType: 'TenantEmployee',
        firstJoinedAtUtc: '2026-10-30T15:00:00Z', lastLeftAtUtc: '2026-10-30T15:30:00Z', attendedSeconds: 1800, sessions: 1,
        speakingSeconds: 120, screenShares: 1, handsRaised: 0,
      },
      {
        userId: 'client', displayName: 'Client Person', avatarFileId: null, role: 'Attendee', actorType: 'CustomerPortal',
        firstJoinedAtUtc: '2026-10-30T15:02:00Z', lastLeftAtUtc: '2026-10-30T15:30:00Z', attendedSeconds: 1380, sessions: 2,
        speakingSeconds: 0, screenShares: 0, handsRaised: 1,
      },
    ],
    invitedNotJoined: [{ kind: 'Employee', displayName: 'Absent Person' }],
    totals: { attendees: 2, peakConcurrent: 2, screenShares: 1, handsRaised: 1, reactions: 0 },
    ...overrides,
  };
}

function render(store: { summary: ReturnType<typeof vi.fn>; events: ReturnType<typeof vi.fn>; chatHistory?: ReturnType<typeof vi.fn> }) {
  TestBed.configureTestingModule({ providers: [{ provide: MeetingsStore, useValue: store }] });
  const fixture = TestBed.createComponent(MeetingDetailsPanelComponent);
  fixture.componentRef.setInput('meeting', MEETING);
  fixture.componentRef.setInput('isOpen', true);
  fixture.detectChanges();
  // El drawer se porta al <body>.
  const panel = document.querySelector('[role="dialog"]') as HTMLElement;
  return { fixture, panel, component: fixture.componentInstance };
}

describe('MeetingDetailsPanelComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="dialog"]').forEach(n => n.parentElement?.remove());
  });

  it('muestra cuándo fue, duración, motivo, host, participantes con su tiempo y quién no entró', () => {
    const store = { summary: vi.fn().mockReturnValue(of(summary())), events: vi.fn() };
    const { panel } = render(store);

    expect(store.summary).toHaveBeenCalledWith('m1');
    const facts = panel.querySelector('[data-role="meeting-facts"]')!.textContent!;
    expect(facts).toContain('30 min');
    expect(facts).toContain('Everyone left');
    expect(facts).toContain('Hosting Person');

    const rows = panel.querySelectorAll('[data-role="details-participants"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Host');
    expect(rows[0].textContent).toContain('Spoke 2 min');
    expect(rows[1].textContent).toContain('Client');
    expect(rows[1].textContent).toContain('joined 2 times');
    expect(rows[1].textContent).toContain('23 min');
    expect(panel.querySelector('[data-role="details-no-shows"]')!.textContent).toContain('Absent Person');
  });

  it('Recording y Transcript avisan a la página con la reunión (transcript de la ficha)', () => {
    const { panel, component } = render({ summary: vi.fn().mockReturnValue(of(summary())), events: vi.fn() });
    const recording: MeetingItem[] = [];
    const transcript: MeetingItem[] = [];
    component.viewRecording.subscribe(m => recording.push(m));
    component.viewTranscript.subscribe(m => transcript.push(m));

    (panel.querySelector('[data-role="details-recording"]') as HTMLButtonElement).click();
    (panel.querySelector('[data-role="details-transcript"]') as HTMLButtonElement).click();

    expect(recording.map(m => m.id)).toEqual(['m1']);
    expect(transcript.map(m => m.transcriptFileId)).toEqual(['tx-1']);
  });

  it('la actividad se pide al abrirla y traduce los eventos con los nombres de la ficha', () => {
    const events = vi.fn().mockReturnValue(
      of({
        items: [
          { seq: 1, at: '2026-10-30T15:00:00Z', type: 'participant.joined', actorUserId: 'host', targetUserId: null, payload: null },
          { seq: 2, at: '2026-10-30T15:01:00Z', type: 'speaker.started', actorUserId: 'host', targetUserId: null, payload: null },
          { seq: 3, at: '2026-10-30T15:02:00Z', type: 'participant.joined', actorUserId: 'client', targetUserId: null, payload: null },
        ],
        nextAfterSeq: null,
      }),
    );
    const { fixture, panel } = render({ summary: vi.fn().mockReturnValue(of(summary())), events });
    expect(events).not.toHaveBeenCalled();

    (panel.querySelector('[data-role="details-activity-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(events).toHaveBeenCalledWith('m1', null);
    const lines = [...panel.querySelectorAll('[data-role="details-activity"] li')].map(li => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Hosting Person joined');
    expect(lines[1]).toContain('Client Person joined');
  });

  it('a quien no participó le explica por qué no ve la ficha', () => {
    const forbidden = new HttpErrorResponse({ status: 403, error: { code: 'Meeting.NotParticipant', message: 'x' } });
    const { panel } = render({ summary: vi.fn().mockReturnValue(throwError(() => forbidden)), events: vi.fn() });
    expect(panel.textContent).toContain('Only people who were in this meeting can see its details.');
  });

  it('F8a (D-01): el chat de la sala se lee en la ficha, en orden cronológico', () => {
    const chatHistory = vi.fn().mockReturnValue(
      of({
        conversationId: 'conv-1',
        isArchived: true,
        items: [
          { id: 'b', senderId: 'client', senderDisplayName: 'Client Person', kind: 'Text', body: 'Thanks!', attachmentFileId: null, isDeleted: false, isEdited: false, createdAtUtc: '2026-10-30T15:05:00Z' },
          { id: 'a', senderId: 'host', senderDisplayName: 'Hosting Person', kind: 'Text', body: 'Welcome', attachmentFileId: null, isDeleted: false, isEdited: false, createdAtUtc: '2026-10-30T15:01:00Z' },
        ],
        nextBeforeUtc: null,
      }),
    );
    const { fixture, panel } = render({ summary: vi.fn().mockReturnValue(of(summary())), events: vi.fn(), chatHistory });

    (panel.querySelector('[data-role="details-chat-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(chatHistory).toHaveBeenCalledWith('m1', null);
    const lines = [...panel.querySelectorAll('[data-role="details-chat"] li')].map(li => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(lines[0]).toContain('Welcome');
    expect(lines[1]).toContain('Thanks!');
  });
});
