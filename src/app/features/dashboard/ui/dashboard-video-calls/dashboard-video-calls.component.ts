import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MeetingsStore } from '../../../meetings/data-access/meetings.store';
import { MeetingItem } from '../../../meetings/data-access/meeting.model';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/** Cuántas reuniones caben en el widget. */
const MAX_ROWS = 5;

const AVATAR_COLORS = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

/**
 * Widget "Video Calls".
 *
 * Antes eran 5 llamadas inventadas, incluida una con el estado "Live now" en
 * verde parpadeante para "Maria Gonzalez" — el dato falso más peligroso del
 * dashboard, porque afirmaba que había una videollamada en curso.
 *
 * Ahora se alimenta del {@link MeetingsStore} real
 * (`GET /communication/meetings?scope=upcoming`), que devuelve las reuniones
 * agendadas y las que están efectivamente en curso (`apiStatus === 'Live'`).
 * `loadScope` es lazy e idempotente: si la página de Meetings ya cargó, esto
 * no repite la llamada.
 *
 * Solo se carga el scope `upcoming`: las pasadas son otra petición y un
 * accesorio del dashboard no debería pagarla.
 *
 * El botón de cámara NO inicia una llamada: `MeetingItem` no expone joinUrl
 * (el token de invitación solo se devuelve una vez, al crear la invitación) y
 * unirse a la sala es Socket.IO, no HTTP. Por eso es un enlace a la página de
 * Meetings, no un botón muerto.
 */
@Component({
  selector: 'app-dashboard-video-calls',
  imports: [CommonModule, RouterLink, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-video-calls.component.html',
})
export class DashboardVideoCallsComponent implements OnInit {
  private readonly store = inject(MeetingsStore);

  readonly loading = this.store.loading;
  readonly error = this.store.error;

  /** Live primero, luego las agendadas más próximas. */
  readonly calls = computed<MeetingItem[]>(() =>
    [...this.store.upcoming()]
      .sort((a, b) => {
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (b.status === 'live' && a.status !== 'live') return 1;
        return this.scheduledMs(a) - this.scheduledMs(b);
      })
      .slice(0, MAX_ROWS),
  );

  /** Reuniones de hoy (agendadas para hoy o ya en curso). */
  readonly todayCount = computed(
    () => this.store.upcoming().filter(meeting => this.isToday(meeting)).length,
  );

  ngOnInit(): void {
    this.store.loadScope('upcoming');
  }

  trackByCallId(_index: number, call: MeetingItem): string {
    return call.id;
  }

  avatarBg(index: number): string {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }

  initialsOf(title: string): string {
    const parts = title.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  /** Línea de estado: en curso con participantes reales, o cuándo está agendada. */
  detailFor(call: MeetingItem): string {
    if (call.status === 'live') {
      return call.joinedCount > 0
        ? `Live now · ${call.joinedCount} joined`
        : 'Live now';
    }
    if (!call.scheduledAt) {
      return 'Not scheduled';
    }
    const date = new Date(call.scheduledAt);
    if (Number.isNaN(date.getTime())) {
      return 'Not scheduled';
    }
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (this.isSameDay(date, new Date())) {
      return `Today, ${time}`;
    }
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
  }

  private isToday(meeting: MeetingItem): boolean {
    if (meeting.status === 'live') {
      return true;
    }
    if (!meeting.scheduledAt) {
      return false;
    }
    const date = new Date(meeting.scheduledAt);
    return !Number.isNaN(date.getTime()) && this.isSameDay(date, new Date());
  }

  private scheduledMs(meeting: MeetingItem): number {
    if (!meeting.scheduledAt) {
      return Number.MAX_SAFE_INTEGER;
    }
    const value = new Date(meeting.scheduledAt).getTime();
    return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    );
  }
}
