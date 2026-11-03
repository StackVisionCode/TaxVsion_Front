import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { toApiError } from '@core/models/api-error.model';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingCodeResolution } from '../../data-access/meeting.model';

/** Mensaje cuando la reunión existe pero no se puede entrar todavía (o ya no). */
function unavailableMessage(resolution: MeetingCodeResolution): string | null {
  switch (resolution.status) {
    case 'Live':
      return null;
    case 'Scheduled':
      return `“${resolution.title}” hasn't started yet. Ask ${resolution.hostDisplayName} to start it.`;
    default:
      return `“${resolution.title}” has ended.`;
  }
}

/**
 * MNT-01 — "Join with code" del staff: el código se resuelve en la oficina del usuario
 * (`GET /meetings/code/{code}`) y, si la reunión está en curso, se emite para entrar por el lobby
 * normal con el id real. Bloqueo, passcode y sala de espera los aplica el join.
 *
 *   <app-meeting-join-code-dialog [isOpen]="open()" (closed)="open.set(false)" (resolved)="join($event)" />
 */
@Component({
  selector: 'app-meeting-join-code-dialog',
  imports: [FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-join-code-dialog.component.html',
})
export class MeetingJoinCodeDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  /** Reunión en curso lista para el lobby. */
  @Output() resolved = new EventEmitter<MeetingCodeResolution>();

  private readonly store = inject(MeetingsStore);

  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly canSubmit = computed(() => this.code().replace(/[\s-]/g, '').length > 0 && !this.busy());

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.code.set('');
      this.error.set(null);
      this.busy.set(false);
    }
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.store.resolveCode(this.code().trim()).subscribe({
      next: resolution => {
        this.busy.set(false);
        const unavailable = unavailableMessage(resolution);
        if (unavailable) {
          this.error.set(unavailable);
          return;
        }
        this.resolved.emit(resolution);
      },
      error: err => {
        this.busy.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 404
            ? 'No meeting with that code in your office. Check the code and try again.'
            : toApiError(err).message,
        );
      },
    });
  }

  close(): void {
    this.closed.emit();
  }
}
