import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  Input,
  OnDestroy,
  afterNextRender,
  inject,
} from '@angular/core';
import type { LaunchPhase } from '../../utils/launch.util';
import { portalToBody } from '../../utils/overlay.util';

/** create: se arma una plantilla · publish: se publica una versión · send: se envía a alguien. */
export type LaunchVariant = 'create' | 'publish' | 'send';

interface SheetRow {
  label: number;
  kind: 'input' | 'choice';
  fill: number;
}

/**
 * Coreografía de pantalla completa para los momentos de "lanzar" algo (crear, publicar, enviar).
 * Mismo idioma que el envío de Signature: una hoja que entra con spring, campos que se arman en
 * cascada, sello final con pop y caption. Es solo presentación: el padre maneja la fase (lo más
 * simple es `runWithLaunch` de `@shared/utils/launch.util`).
 *
 * Uso: `<app-launch-overlay variant="send" [phase]="launch()" workingCaption="Sending to Ana…"
 *   doneCaption="Sent to Ana" />`
 *
 * `exit="hold"` deja la pantalla cubierta al terminar (en vez de desvanecerse) para navegar por
 * debajo sin parpadeo; la vista nueva hace su propia entrada.
 */
@Component({
  selector: 'app-launch-overlay',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './launch-overlay.component.css',
  template: `
    @if (phase !== 'idle') {
      <div
        class="launch-overlay fixed inset-0 z-[70] flex flex-col items-center justify-center bg-white"
        [class.launch-out]="phase === 'done' && exit === 'fade'"
        [class.launch-hold]="phase === 'done' && exit === 'hold'"
        role="status"
        aria-live="polite"
      >
        <div class="launch-stage relative">
          <div
            class="launch-sheet relative w-72 rounded-2xl border border-gray-100 bg-white p-5 shadow-2xl"
            [class]="'variant-' + variant"
            [class.is-done]="phase === 'done'"
          >
            <div class="flex items-center gap-2.5">
              <span class="sheet-badge grid h-8 w-8 place-items-center rounded-xl bg-brand-bold/10 text-brand-bold">
                <ion-icon [name]="headerIcon" class="text-base"></ion-icon>
              </span>
              <div class="flex-1 space-y-1.5">
                <div class="sheet-line h-2.5 w-32 rounded-full bg-gray-200"></div>
                <div class="sheet-line h-1.5 w-20 rounded-full bg-gray-100"></div>
              </div>
              @if (variant === 'publish' && badge) {
                <span class="sheet-version rounded-full bg-emerald-50 px-2 py-0.5 text-[0.6875rem] font-bold text-emerald-700">
                  {{ badge }} · Live
                </span>
              }
            </div>

            <div class="mt-5 space-y-3.5">
              @for (row of rows; track $index) {
                <div class="sheet-row" [style.--i]="$index">
                  <div class="h-1.5 rounded-full bg-gray-200" [style.width.%]="row.label"></div>
                  @if (row.kind === 'choice') {
                    <div class="mt-2 flex gap-3">
                      <span class="sheet-radio is-picked"></span>
                      <span class="sheet-radio"></span>
                      <span class="sheet-radio"></span>
                    </div>
                  } @else {
                    <div class="sheet-input mt-1.5 h-7 overflow-hidden rounded-lg border border-gray-200 px-2">
                      <span class="sheet-fill block h-1.5 rounded-full bg-brand-bold/25" [style.width.%]="row.fill"></span>
                    </div>
                  }
                </div>
              }
            </div>

            @if (variant === 'publish') {
              <span class="sheet-scan" aria-hidden="true"></span>
            }

            @if (phase === 'done') {
              <span
                class="launch-stamp absolute -right-3 -top-3 grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white shadow-lg"
              >
                <ion-icon name="checkmark" class="text-xl"></ion-icon>
              </span>
            }
          </div>

          @if (variant === 'send' && phase === 'done') {
            <span class="launch-plane absolute left-1/2 top-1/2 text-2xl text-brand-bold" aria-hidden="true">
              <ion-icon name="paper-plane-outline"></ion-icon>
            </span>
          }
        </div>

        <p class="launch-caption mt-8 text-sm font-medium text-gray-600">
          {{ phase === 'done' ? doneCaption : workingCaption }}
        </p>
      </div>
    }
  `,
})
export class LaunchOverlayComponent implements OnDestroy {
  @Input() phase: LaunchPhase = 'idle';
  @Input() variant: LaunchVariant = 'send';
  @Input() workingCaption = '';
  @Input() doneCaption = '';
  /** Etiqueta del sello de versión (solo `publish`), p. ej. "v2". */
  @Input() badge = '';
  @Input() exit: 'fade' | 'hold' = 'fade';

  readonly rows: readonly SheetRow[] = [
    { label: 44, kind: 'input', fill: 62 },
    { label: 32, kind: 'choice', fill: 0 },
    { label: 52, kind: 'input', fill: 40 },
    { label: 28, kind: 'input', fill: 74 },
  ];

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Al body: un ancestro con transform (drawer, builder) encerraría el `fixed` del overlay.
    afterNextRender(() => portalToBody(this.host.nativeElement));
  }

  get headerIcon(): string {
    if (this.variant === 'publish') return 'lock-closed-outline';
    if (this.variant === 'create') return 'sparkles-outline';
    return 'document-text-outline';
  }

  ngOnDestroy(): void {
    // El host se portó al body: se quita a mano por si Angular solo lo despega de su sitio original.
    this.host.nativeElement.remove();
  }
}
