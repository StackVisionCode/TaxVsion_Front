import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output } from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/**
 * F4 — Diálogo de consentimiento de grabación, común a llamadas y reuniones (antes dos copias).
 *
 *   <app-recording-consent [requesterName]="recordingRequesterName()" scope="meeting"
 *     (accepted)="acceptRecording()" (declined)="declineRecording()" />
 *
 * `requesterName` null = cerrado. Cerrar con X/Escape/backdrop cuenta como "Decline".
 */
@Component({
  selector: 'app-recording-consent',
  imports: [ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-modal [isOpen]="requesterName() !== null" [heading]="heading()" size="sm" (closed)="declined.emit()">
      <div class="mt-4 flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
          <ion-icon name="radio-button-on-outline" class="text-xl"></ion-icon>
        </span>
        <p class="text-sm text-gray-500">The {{ scope() }} will be recorded only if you allow it. Everyone will see a "REC" badge while it's on.</p>
      </div>
      <div class="mt-5 flex items-center justify-end gap-2">
        <button type="button" (click)="declined.emit()"
          class="rounded-full border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">
          Decline
        </button>
        <button type="button" (click)="accepted.emit()"
          class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink">
          Allow recording
        </button>
      </div>
    </app-modal>
  `,
})
export class RecordingConsentComponent {
  /** Quién pidió grabar; null = diálogo cerrado. */
  readonly requesterName = input<string | null>(null);
  readonly scope = input<'call' | 'meeting'>('meeting');
  readonly accepted = output<void>();
  readonly declined = output<void>();

  readonly heading = computed(() => `${this.requesterName() ?? 'A participant'} wants to record this ${this.scope()}`);
}
