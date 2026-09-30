import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { SrcObjectDirective } from '@core/communication/src-object.directive';
import { ConnectionBars, connectionLabel } from '@core/communication/connection-quality.util';

/**
 * Tile de video de un participante (presentacional). El `<video>` va SIEMPRE muteado: el audio de
 * cada remoto lo reproduce un `<audio>` aparte en la sala, así sigue sonando aunque su tile no se
 * pinte (overflow "+N") o se mueva entre la grilla y el panel flotante.
 *
 * Muestra: nombre truncado (con tooltip del nombre completo), rol, mano levantada, mic apagado,
 * medidor de calidad LOCAL (barras) e indicador de "hablando" (anillo en el tile; con la cámara
 * apagada, anillo pulsante + barras animadas alrededor del avatar). El menú de host se proyecta.
 */
@Component({
  selector: 'app-meeting-tile',
  imports: [SrcObjectDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting-tile.component.html',
  styleUrl: './meeting-tile.component.css',
})
export class MeetingTileComponent {
  @Input({ required: true }) name = '';
  @Input() stream: MediaStream | null = null;
  @Input() videoOn = false;
  @Input() audioOn = true;
  @Input() isLocal = false;
  @Input() handRaised = false;
  @Input() speaking = false;
  @Input() quality: ConnectionBars = 0;
  @Input() roleLabel: string | null = null;
  @Input() pinned = false;
  @Input() canPin = false;
  /** Variante chica (panel flotante / filmstrip): tipografía y avatar más chicos. */
  @Input() compact = false;
  @Input() initials = '';
  /** Clase de color del avatar (bg-*). */
  @Input() avatarClass = 'bg-brand-bold';

  @Output() pinToggle = new EventEmitter<void>();

  readonly bars = [1, 2, 3, 4] as const;

  get showVideo(): boolean {
    return this.videoOn && !!this.stream;
  }

  get pinBtnClass(): string {
    const size = this.compact ? 'h-7 w-7' : 'h-8 w-8';
    return this.pinned ? `${size} bg-brand-bold pin-btn--visible` : `${size} bg-black/40 hover:bg-black/60`;
  }

  get qualityText(): string {
    return connectionLabel(this.quality);
  }

  get qualityColor(): string {
    if (this.quality >= 3) return 'bg-emerald-400';
    if (this.quality === 2) return 'bg-amber-400';
    return 'bg-red-500';
  }

  onPin(event: MouseEvent): void {
    event.stopPropagation();
    this.pinToggle.emit();
  }
}
