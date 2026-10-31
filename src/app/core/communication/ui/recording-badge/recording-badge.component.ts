import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RecordingState, isRecordingProcessing } from '../../recording-status';

/**
 * F7 — Badge de grabación común a la sala, el mini-player y el overlay de llamada:
 *  - `Recording`: pill roja "REC 1:23" y, con tope, "· 4:37 left".
 *  - `Composing` / `Processing`: etiqueta "Processing recording…" en el mismo lugar.
 *  - Otros estados: nada.
 *
 *   <app-recording-badge [state]="recordingState()" [elapsed]="recordingElapsedLabel()"
 *     [remaining]="recordingRemainingLabel()" pillClass="…" />
 *
 * `pillClass` / `processingClass` reemplazan las clases por defecto (cada contenedor tiene su estilo).
 */
@Component({
  selector: 'app-recording-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (state() === 'Recording') {
      <span data-role="rec-badge" [class]="pillClass()" [attr.aria-label]="ariaLabel()">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-white animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
        REC {{ elapsed() }}
        @if (remaining()) {
          <span data-role="rec-remaining" class="font-medium opacity-80">· {{ remaining() }} left</span>
        }
      </span>
    } @else if (processing()) {
      <span data-role="rec-processing" role="status" [class]="processingClass()">Processing recording…</span>
    }
  `,
})
export class RecordingBadgeComponent {
  readonly state = input<RecordingState>('Idle');
  /** "1:23" transcurrido. */
  readonly elapsed = input('0:00');
  /** "4:37" restante; null sin tope. */
  readonly remaining = input<string | null>(null);
  readonly pillClass = input(
    'inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[0.625rem] font-semibold tabular-nums text-white',
  );
  readonly processingClass = input('inline-flex items-center gap-1 text-[0.625rem] font-medium text-gray-300');

  readonly processing = computed(() => isRecordingProcessing(this.state()));
  readonly ariaLabel = computed(() => {
    const remaining = this.remaining();
    return `Recording ${this.elapsed()}${remaining ? `, ${remaining} left` : ''}`;
  });
}
