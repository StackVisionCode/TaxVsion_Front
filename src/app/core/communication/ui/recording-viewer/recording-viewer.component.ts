import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { RecordingPlayerComponent } from '../recording-player/recording-player.component';
import { RecordingScope } from '../../recordings/recording-playback.model';

/**
 * F7 — Modal con el reproductor de una grabación y su transcript (reuniones y llamadas). Las features
 * lo montan con `@defer (when …)` para que el reproductor no viaje en su chunk principal.
 *
 *   @defer (when recordingTarget()) {
 *     <app-recording-viewer [isOpen]="!!recordingTarget()" scope="meeting" [targetId]="recordingTarget()?.id ?? null"
 *       [heading]="recordingTarget()?.title ?? 'Recording'" (closed)="recordingTarget.set(null)" />
 *   }
 *
 * `targetId` null = sin contenido (el modal puede estar animando el cierre).
 */
@Component({
  selector: 'app-recording-viewer',
  imports: [ModalComponent, RecordingPlayerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [isOpen]="isOpen()" [heading]="heading()" subheading="Recording and transcript" size="2xl" (closed)="closed.emit()">
      @if (targetId(); as id) {
        <div class="mt-4">
          <app-recording-player [scope]="scope()" [targetId]="id" />
        </div>
      }
    </app-modal>
  `,
})
export class RecordingViewerComponent {
  readonly isOpen = input(false);
  readonly scope = input<RecordingScope>('meeting');
  readonly targetId = input<string | null>(null);
  readonly heading = input('Recording');
  readonly closed = output<void>();
}
