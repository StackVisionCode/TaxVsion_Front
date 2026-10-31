import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import { toApiError } from '@core/models/api-error.model';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingItem, MeetingSummaryParticipant, MeetingSummaryResponse } from '../../data-access/meeting.model';
import { MeetingActivityLine, describeMeetingEvent, endReasonText, formatSeconds } from '../../utils/meeting-details';

const STATUS_TONE: Record<string, StatusTone> = { Live: 'success', Scheduled: 'brand', Ended: 'muted', Cancelled: 'danger', Expired: 'muted' };

/**
 * Ficha de una reunión: cuándo fue y cuánto duró, quién estuvo (tiempo total sumando reingresos,
 * voz, pantalla y manos), quién no entró (solo host/cohost) y la actividad del log bajo demanda.
 */
@Component({
  selector: 'app-meeting-details-panel',
  imports: [DrawerComponent, AvatarComponent, AvatarUrlPipe, StatusPillComponent, StateBlockComponent, InfinityLoaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-details-panel.component.html',
})
export class MeetingDetailsPanelComponent implements OnChanges {
  private readonly store = inject(MeetingsStore);

  @Input() isOpen = false;
  @Input() meeting: MeetingItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() viewRecording = new EventEmitter<MeetingItem>();
  @Output() viewTranscript = new EventEmitter<MeetingItem>();

  readonly summary = signal<MeetingSummaryResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly activityOpen = signal(false);
  readonly activity = signal<MeetingActivityLine[]>([]);
  readonly activityLoading = signal(false);
  readonly activityError = signal<string | null>(null);
  private activityNextSeq: number | null = null;
  /** Quién está dentro según lo ya leído del log (se arrastra entre páginas). */
  private activityPresent = new Set<string>();
  readonly activityHasMore = signal(false);

  readonly facts = computed(() => {
    const s = this.summary();
    if (!s) return [];
    const m = s.meeting;
    const rows: { label: string; value: string }[] = [];
    if (m.startedAtUtc) {
      rows.push({ label: 'Date', value: formatDate(m.startedAtUtc) });
      rows.push({ label: 'Time', value: m.endedAtUtc ? `${formatTime(m.startedAtUtc)} – ${formatTime(m.endedAtUtc)}` : `Started ${formatTime(m.startedAtUtc)}` });
    } else if (m.scheduledForUtc) {
      rows.push({ label: 'Scheduled for', value: `${formatDate(m.scheduledForUtc)} · ${formatTime(m.scheduledForUtc)}` });
    }
    if (m.durationSeconds) rows.push({ label: 'Duration', value: formatSeconds(m.durationSeconds) });
    const reason = endReasonText(m.endReason);
    if (reason) rows.push({ label: 'Ended', value: reason });
    if (m.hostName) rows.push({ label: 'Host', value: m.hostName });
    if (m.startedAtUtc && m.scheduledForUtc) rows.push({ label: 'Scheduled for', value: `${formatDate(m.scheduledForUtc)} · ${formatTime(m.scheduledForUtc)}` });
    return rows;
  });

  readonly stats = computed(() => {
    const t = this.summary()?.totals;
    if (!t) return [];
    const all = [
      { label: 'Attended', value: t.attendees, icon: 'people-outline', always: true },
      { label: 'Most at once', value: t.peakConcurrent, icon: 'trending-up-outline', always: true },
      { label: 'Screen shares', value: t.screenShares, icon: 'desktop-outline', always: false },
      { label: 'Hands raised', value: t.handsRaised, icon: 'hand-left-outline', always: false },
      { label: 'Reactions', value: t.reactions, icon: 'happy-outline', always: false },
    ];
    return all.filter(s => s.always || s.value > 0);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['isOpen'] || changes['meeting']) && this.isOpen && this.meeting && this.summary()?.meeting.id !== this.meeting.id) {
      this.load();
    }
  }

  load(): void {
    const meeting = this.meeting;
    if (!meeting) return;
    this.summary.set(null);
    this.error.set(null);
    this.loading.set(true);
    this.resetActivity();
    this.store.summary(meeting.id).subscribe({
      next: summary => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: err => {
        const apiError = toApiError(err);
        this.error.set(apiError.code === 'Meeting.NotParticipant' ? 'Only people who were in this meeting can see its details.' : apiError.message);
        this.loading.set(false);
      },
    });
  }

  toggleActivity(): void {
    const open = !this.activityOpen();
    this.activityOpen.set(open);
    if (open && this.activity().length === 0 && !this.activityLoading()) this.loadActivity();
  }

  loadActivity(): void {
    const meeting = this.meeting;
    if (!meeting) return;
    this.activityLoading.set(true);
    this.activityError.set(null);
    this.store.events(meeting.id, this.activityNextSeq).subscribe({
      next: page => {
        const names = this.nameLookup();
        const lines = page.items.map(event => describeMeetingEvent(event, names, this.activityPresent)).filter((line): line is MeetingActivityLine => line !== null);
        this.activity.update(current => [...current, ...lines]);
        this.activityNextSeq = page.nextAfterSeq;
        this.activityHasMore.set(page.nextAfterSeq !== null);
        this.activityLoading.set(false);
      },
      error: err => {
        this.activityError.set(toApiError(err).message);
        this.activityLoading.set(false);
      },
    });
  }

  close(): void {
    this.closed.emit();
  }

  openRecording(): void {
    if (this.meeting) this.viewRecording.emit(this.meeting);
  }

  openTranscript(): void {
    const meeting = this.meeting;
    const transcriptFileId = this.summary()?.meeting.transcriptFileId ?? meeting?.transcriptFileId ?? null;
    if (meeting && transcriptFileId) this.viewTranscript.emit({ ...meeting, transcriptFileId });
  }

  hasRecording(): boolean {
    const state = this.summary()?.meeting.recordingState ?? this.meeting?.recordingState ?? null;
    return state !== null && state !== undefined;
  }

  hasTranscript(): boolean {
    return !!(this.summary()?.meeting.transcriptFileId ?? this.meeting?.transcriptFileId);
  }

  statusTone(status: string): StatusTone {
    return STATUS_TONE[status] ?? 'muted';
  }

  roleLabel(p: MeetingSummaryParticipant): string | null {
    if (p.role === 'Host') return 'Host';
    if (p.role === 'Cohost') return 'Co-host';
    return null;
  }

  actorLabel(p: MeetingSummaryParticipant): string | null {
    if (p.actorType === 'CustomerPortal') return 'Client';
    if (p.actorType === 'Guest') return 'Guest';
    return null;
  }

  presenceLine(p: MeetingSummaryParticipant): string {
    const from = p.firstJoinedAtUtc ? formatTime(p.firstJoinedAtUtc) : '';
    const to = p.lastLeftAtUtc ? formatTime(p.lastLeftAtUtc) : '';
    const range = from && to ? `${from} – ${to}` : from;
    return p.sessions > 1 ? `${range} · joined ${p.sessions} times` : range;
  }

  extrasLine(p: MeetingSummaryParticipant): string {
    const parts: string[] = [];
    if (p.speakingSeconds > 0) parts.push(`Spoke ${formatSeconds(p.speakingSeconds)}`);
    if (p.screenShares > 0) parts.push(`Shared screen${p.screenShares > 1 ? ` ×${p.screenShares}` : ''}`);
    if (p.handsRaised > 0) parts.push(`Raised hand${p.handsRaised > 1 ? ` ×${p.handsRaised}` : ''}`);
    return parts.join(' · ');
  }

  inviteeKindLabel(kind: string): string {
    return kind === 'Customer' ? 'Client' : kind === 'External' ? 'Guest' : 'Team';
  }

  readonly formatSeconds = formatSeconds;
  readonly formatTime = formatTime;

  private resetActivity(): void {
    this.activityOpen.set(false);
    this.activity.set([]);
    this.activityError.set(null);
    this.activityHasMore.set(false);
    this.activityNextSeq = null;
    this.activityPresent = new Set<string>();
  }

  private nameLookup(): (userId: string | null) => string {
    const names = new Map((this.summary()?.participants ?? []).map(p => [p.userId.toLowerCase(), p.displayName]));
    const host = this.summary()?.meeting;
    if (host?.hostName) names.set(host.hostUserId.toLowerCase(), host.hostName);
    return userId => (userId ? (names.get(userId.toLowerCase()) ?? 'Someone') : 'Someone');
  }
}

function formatDate(iso: string): string {
  return parseUtcDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  return parseUtcDate(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
