import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type CallStatus = 'ongoing' | 'upcoming' | 'completed' | 'missed';

interface VideoCall {
  id: string;
  name: string;
  initials: string;
  status: CallStatus;
  /** Status detail: time for upcoming, duration for completed. */
  detail: string;
  isToday: boolean;
  /** Solid avatar circle color (Aether rotation). */
  avatarBg: string;
}

const AVATAR_COLORS = [
  'bg-gray-900',
  'bg-indigo-600',
  'bg-[#7C6AE0]',
  'bg-orange-500',
  'bg-emerald-500',
];

/**
 * Widget "Video Calls" (referencia "Aether"): lista de llamadas con avatar de
 * iniciales, línea de estado (Live/Upcoming/Completed/Missed) y botón fantasma
 * circular con icono de videocámara. Datos estáticos, sin backend.
 */
@Component({
  selector: 'app-dashboard-video-calls',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-video-calls.component.html',
})
export class DashboardVideoCallsComponent {
  readonly calls = signal<VideoCall[]>([
    {
      id: 'call-1',
      name: 'Maria Gonzalez',
      initials: 'MG',
      status: 'ongoing',
      detail: 'Live now',
      isToday: true,
      avatarBg: AVATAR_COLORS[0],
    },
    {
      id: 'call-2',
      name: 'John Smith',
      initials: 'JS',
      status: 'upcoming',
      detail: 'Today, 2:30 PM',
      isToday: true,
      avatarBg: AVATAR_COLORS[1],
    },
    {
      id: 'call-3',
      name: 'Acme Corp',
      initials: 'AC',
      status: 'completed',
      detail: '32:15',
      isToday: false,
      avatarBg: AVATAR_COLORS[2],
    },
    {
      id: 'call-4',
      name: 'Sarah Lee',
      initials: 'SL',
      status: 'missed',
      detail: 'Missed',
      isToday: false,
      avatarBg: AVATAR_COLORS[3],
    },
    {
      id: 'call-5',
      name: 'David Kim',
      initials: 'DK',
      status: 'completed',
      detail: '15:42',
      isToday: false,
      avatarBg: AVATAR_COLORS[4],
    },
  ]);

  readonly todayCount = computed(() => this.calls().filter(call => call.isToday).length);

  trackByCallId(_index: number, call: VideoCall): string {
    return call.id;
  }
}
