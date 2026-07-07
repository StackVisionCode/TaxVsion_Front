import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MeetingItem } from '../meeting-list/meeting-list.component';

const DURATIONS = [15, 30, 45, 60, 90];

const PARTICIPANT_COLORS = ['bg-indigo-500', 'bg-orange-500', 'bg-[#7C6AE0]', 'bg-emerald-500', 'bg-gray-900'];

/**
 * Overlay de programar/editar reunión (mismo patrón que task-create-panel):
 * tarjeta centrada `rounded-[28px]` sobre backdrop con stopPropagation. Un
 * único componente cubre ambos modos: si `meeting` llega con datos precarga
 * el formulario y actúa como edición; si es null arranca vacío. `isEditMode`
 * es una signal propia actualizada en ngOnChanges (no un computed() sobre el
 * @Input, que no reaccionaría a sus cambios).
 */
@Component({
  selector: 'app-meeting-schedule-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-schedule-panel.component.html',
})
export class MeetingSchedulePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() meeting: MeetingItem | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<MeetingItem>();

  readonly durations = DURATIONS;

  readonly isEditMode = signal(false);

  readonly title = signal('');
  readonly client = signal('');
  readonly date = signal('');
  readonly time = signal('');
  readonly duration = signal(30);
  readonly notes = signal('');
  readonly participantDraft = signal('');
  readonly participants = signal<{ name: string; initials: string; color: string }[]>([]);

  readonly isDurationOpen = signal(false);

  readonly canSave = computed(
    () => this.title().trim().length > 0 && !!this.date() && !!this.time(),
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['meeting'] || changes['isOpen']) {
      this.isEditMode.set(this.meeting !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="meeting-duration"]')) {
      this.isDurationOpen.set(false);
    }
  }

  toggleDurationDropdown(): void {
    this.isDurationOpen.update(open => !open);
  }

  selectDuration(minutes: number): void {
    this.duration.set(minutes);
    this.isDurationOpen.set(false);
  }

  addParticipant(): void {
    const name = this.participantDraft().trim();
    if (!name) {
      return;
    }
    const initials = name
      .split(' ')
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const color = PARTICIPANT_COLORS[this.participants().length % PARTICIPANT_COLORS.length];
    this.participants.update(list => [...list, { name, initials, color }]);
    this.participantDraft.set('');
  }

  removeParticipant(index: number): void {
    this.participants.update(list => list.filter((_, i) => i !== index));
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const scheduledAt = new Date(`${this.date()}T${this.time()}`).toISOString();
    const result: MeetingItem = {
      id: this.meeting?.id ?? `meeting-${Date.now()}`,
      title: this.title().trim(),
      client: this.client().trim(),
      scheduledAt,
      durationMinutes: this.duration(),
      status: this.meeting?.status ?? 'upcoming',
      participants: this.participants(),
      hasRecording: this.meeting?.hasRecording ?? false,
      notes: this.notes().trim(),
    };
    this.saved.emit(result);
  }

  private resetForm(): void {
    const meeting = this.meeting;
    if (meeting) {
      const scheduled = new Date(meeting.scheduledAt);
      this.title.set(meeting.title);
      this.client.set(meeting.client);
      this.date.set(scheduled.toISOString().slice(0, 10));
      this.time.set(scheduled.toISOString().slice(11, 16));
      this.duration.set(meeting.durationMinutes);
      this.notes.set(meeting.notes);
      this.participants.set([...meeting.participants]);
    } else {
      this.title.set('');
      this.client.set('');
      this.date.set('');
      this.time.set('');
      this.duration.set(30);
      this.notes.set('');
      this.participants.set([]);
    }
    this.participantDraft.set('');
    this.isDurationOpen.set(false);
  }
}
