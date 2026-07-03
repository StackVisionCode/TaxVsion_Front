import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder list of recent/upcoming video calls for the dashboard
 * widget. No websocket/video-call services attached — the "ongoing" call and
 * the refresh spinner are purely cosmetic, driven by local signals only.
 */
type CallStatus = 'ongoing' | 'upcoming' | 'completed' | 'missed';
type CallKind = 'video' | 'audio';
type StatusColor = 'red' | 'green' | 'gray' | 'blue';

interface VideoCallItem {
  id: string;
  displayName: string;
  photoUrl?: string;
  initials: string;
  callType: CallKind;
  status: CallStatus;
  statusColor: StatusColor;
  statusIcon: string;
  formattedTime: string;
  formattedDuration: string;
  isOngoing: boolean;
  isToday: boolean;
}

@Component({
  selector: 'app-dashboard-video-calls',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-video-calls.component.html',
  styleUrl: './dashboard-video-calls.component.scss',
})
export class DashboardVideoCallsComponent {
  readonly isLoading = signal(false);

  readonly calls = signal<VideoCallItem[]>([
    {
      id: 'call-1',
      displayName: 'Maria Gonzalez',
      initials: 'MG',
      callType: 'video',
      status: 'ongoing',
      statusColor: 'green',
      statusIcon: 'videocam',
      formattedTime: 'Now',
      formattedDuration: '00:00',
      isOngoing: true,
      isToday: true,
    },
    {
      id: 'call-2',
      displayName: 'John Smith',
      initials: 'JS',
      callType: 'audio',
      status: 'upcoming',
      statusColor: 'blue',
      statusIcon: 'call',
      formattedTime: 'Today, 2:30 PM',
      formattedDuration: '00:00',
      isOngoing: false,
      isToday: true,
    },
    {
      id: 'call-3',
      displayName: 'Acme Corp',
      initials: 'AC',
      callType: 'video',
      status: 'completed',
      statusColor: 'green',
      statusIcon: 'videocam',
      formattedTime: 'Yesterday',
      formattedDuration: '32:15',
      isOngoing: false,
      isToday: false,
    },
    {
      id: 'call-4',
      displayName: 'Sarah Lee',
      initials: 'SL',
      callType: 'video',
      status: 'missed',
      statusColor: 'gray',
      statusIcon: 'call',
      formattedTime: '2 days ago',
      formattedDuration: '00:00',
      isOngoing: false,
      isToday: false,
    },
    {
      id: 'call-5',
      displayName: 'David Kim',
      initials: 'DK',
      callType: 'audio',
      status: 'completed',
      statusColor: 'green',
      statusIcon: 'call',
      formattedTime: '3 days ago',
      formattedDuration: '15:42',
      isOngoing: false,
      isToday: false,
    },
  ]);

  readonly todayCallsCount = computed(() => this.calls().filter(c => c.isToday).length);
  readonly ongoingCallsCount = computed(() => this.calls().filter(c => c.isOngoing).length);

  refresh(): void {
    // No backend to refresh from yet — just replays the loading spinner briefly.
    this.isLoading.set(true);
    setTimeout(() => this.isLoading.set(false), 600);
  }
}
