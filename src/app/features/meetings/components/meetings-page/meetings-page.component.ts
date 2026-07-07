import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MeetingItem, MeetingListComponent } from '../../ui/meeting-list/meeting-list.component';
import { MeetingSchedulePanelComponent } from '../../ui/meeting-schedule-panel/meeting-schedule-panel.component';
import { MeetingRoomPreviewComponent } from '../../ui/meeting-room-preview/meeting-room-preview.component';

type MeetingsTab = 'upcoming' | 'past';

/** Builds an ISO datetime string relative to now so the mock agenda always looks alive. */
function atOffsetHours(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() + hours, 0, 0, 0);
  return date.toISOString();
}

const SEED_MEETINGS: MeetingItem[] = [
  {
    id: 'meeting-1',
    title: 'Q2 review call',
    client: 'Johnson & Co LLC',
    scheduledAt: atOffsetHours(2),
    durationMinutes: 30,
    status: 'upcoming',
    participants: [
      { name: 'James Cooper', initials: 'JC', color: 'bg-indigo-500' },
      { name: 'You', initials: 'ME', color: 'bg-gray-900' },
    ],
    hasRecording: false,
    notes: 'Walk through the draft Q2 estimated tax filing before submission.',
  },
  {
    id: 'meeting-2',
    title: 'Onboarding kickoff',
    client: 'Delgado Family Trust',
    scheduledAt: atOffsetHours(0.1),
    durationMinutes: 45,
    status: 'live',
    participants: [
      { name: 'Aisha Thompson', initials: 'AT', color: 'bg-emerald-500' },
      { name: 'You', initials: 'ME', color: 'bg-gray-900' },
      { name: 'Marcus Webb', initials: 'MW', color: 'bg-orange-500' },
    ],
    hasRecording: false,
    notes: 'Gather entity details and prior year returns.',
  },
  {
    id: 'meeting-3',
    title: 'IRS audit prep',
    client: 'Sunrise Bakery Inc.',
    scheduledAt: atOffsetHours(26),
    durationMinutes: 60,
    status: 'upcoming',
    participants: [
      { name: 'Elena Vargas', initials: 'EV', color: 'bg-orange-500' },
      { name: 'Sarah Mitchell', initials: 'SM', color: 'bg-[#7C6AE0]' },
      { name: 'You', initials: 'ME', color: 'bg-gray-900' },
    ],
    hasRecording: false,
    notes: 'Prepare documentation ahead of the scheduled audit.',
  },
  {
    id: 'meeting-4',
    title: 'Engagement letter walkthrough',
    client: 'Robert Kim',
    scheduledAt: atOffsetHours(50),
    durationMinutes: 15,
    status: 'upcoming',
    participants: [{ name: 'Sarah Mitchell', initials: 'SM', color: 'bg-[#7C6AE0]' }],
    hasRecording: false,
    notes: '',
  },
  {
    id: 'meeting-5',
    title: 'Bookkeeping reconciliation review',
    client: 'Summit Bakery Inc.',
    scheduledAt: atOffsetHours(-26),
    durationMinutes: 30,
    status: 'ended',
    participants: [
      { name: 'James Cooper', initials: 'JC', color: 'bg-indigo-500' },
      { name: 'You', initials: 'ME', color: 'bg-gray-900' },
    ],
    hasRecording: true,
    notes: 'Reviewed Q1 bank statement discrepancies.',
  },
  {
    id: 'meeting-6',
    title: 'S-corp filing strategy',
    client: 'Ferreira S-Corp',
    scheduledAt: atOffsetHours(-50),
    durationMinutes: 60,
    status: 'ended',
    participants: [
      { name: 'James Cooper', initials: 'JC', color: 'bg-indigo-500' },
      { name: 'Aisha Thompson', initials: 'AT', color: 'bg-emerald-500' },
      { name: 'Marcus Webb', initials: 'MW', color: 'bg-orange-500' },
      { name: 'Sarah Mitchell', initials: 'SM', color: 'bg-[#7C6AE0]' },
      { name: 'You', initials: 'ME', color: 'bg-gray-900' },
    ],
    hasRecording: true,
    notes: 'Discussed distribution timing and reasonable salary.',
  },
  {
    id: 'meeting-7',
    title: 'Amended return discussion',
    client: 'Sarah Kim',
    scheduledAt: atOffsetHours(-75),
    durationMinutes: 30,
    status: 'ended',
    participants: [{ name: 'Elena Vargas', initials: 'EV', color: 'bg-orange-500' }],
    hasRecording: false,
    notes: 'Client had additional questions after the amendment was filed.',
  },
  {
    id: 'meeting-8',
    title: 'Payroll setup call',
    client: 'Webb Holdings',
    scheduledAt: atOffsetHours(-100),
    durationMinutes: 45,
    status: 'cancelled',
    participants: [{ name: 'Aisha Thompson', initials: 'AT', color: 'bg-emerald-500' }],
    hasRecording: false,
    notes: 'Client requested to reschedule.',
  },
];

/**
 * Página del módulo Meetings (estilo "Aether"): agenda con stats pastel +
 * tabs Upcoming/Past + búsqueda + panel de programar/editar + vista previa
 * estática de sala (sin WebRTC real). Todo el estado vive en signals dentro
 * de esta página.
 */
@Component({
  selector: 'app-meetings-page',
  imports: [CommonModule, FormsModule, MeetingListComponent, MeetingSchedulePanelComponent, MeetingRoomPreviewComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meetings-page.component.html',
})
export class MeetingsPageComponent {
  readonly meetings = signal<MeetingItem[]>(SEED_MEETINGS);

  readonly activeTab = signal<MeetingsTab>('upcoming');
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingMeeting = signal<MeetingItem | null>(null);
  readonly activeRoomMeeting = signal<MeetingItem | null>(null);

  readonly todayCount = computed(() => {
    const now = new Date();
    return this.meetings().filter(m => {
      const date = new Date(m.scheduledAt);
      return (
        date.toDateString() === now.toDateString() &&
        (m.status === 'upcoming' || m.status === 'live')
      );
    }).length;
  });

  readonly thisWeekCount = computed(() => {
    const weekFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
    return this.meetings().filter(
      m => (m.status === 'upcoming' || m.status === 'live') && new Date(m.scheduledAt).getTime() <= weekFromNow,
    ).length;
  });

  readonly avgParticipants = computed(() => {
    const meetings = this.meetings();
    if (!meetings.length) return 0;
    return Math.round(
      meetings.reduce((sum, m) => sum + m.participants.length, 0) / meetings.length,
    );
  });

  readonly recordingsCount = computed(() => this.meetings().filter(m => m.hasRecording).length);

  readonly visibleMeetings = computed<MeetingItem[]>(() => {
    const query = this.search().trim().toLowerCase();
    const tab = this.activeTab();
    return this.meetings()
      .filter(m => (tab === 'upcoming' ? m.status === 'upcoming' || m.status === 'live' : m.status === 'ended' || m.status === 'cancelled'))
      .filter(m => !query || m.title.toLowerCase().includes(query) || m.client.toLowerCase().includes(query))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  });

  setTab(tab: MeetingsTab): void {
    this.activeTab.set(tab);
  }

  openSchedulePanel(): void {
    this.editingMeeting.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(meeting: MeetingItem): void {
    this.editingMeeting.set(meeting);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingMeeting.set(null);
  }

  handleSaved(meeting: MeetingItem): void {
    this.meetings.update(list => {
      const exists = list.some(item => item.id === meeting.id);
      return exists ? list.map(item => (item.id === meeting.id ? meeting : item)) : [...list, meeting];
    });
    this.closePanel();
  }

  cancelMeeting(meeting: MeetingItem): void {
    this.meetings.update(list =>
      list.map(item => (item.id === meeting.id ? { ...item, status: 'cancelled' as const } : item)),
    );
  }

  joinMeeting(meeting: MeetingItem): void {
    this.activeRoomMeeting.set(meeting);
  }

  leaveMeeting(): void {
    this.activeRoomMeeting.set(null);
  }
}
