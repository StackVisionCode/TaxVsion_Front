import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output } from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { formatRelativeTime } from '@shared/utils/format.util';
import { SrcObjectDirective } from '../../src-object.directive';
import { QualityBadgeComponent } from '../quality-badge/quality-badge.component';
import type { MeetingParticipantDto } from '../../meeting.model';
import type { MeetingHostTileAction } from '../../active-meeting.service';
import type { MeetingReaction } from '../../meeting-reactions.util';
import type { QualityMetrics } from '../../media/derive-quality';
import { isRoleEligible } from '../../meeting-participants.util';

export type ParticipantTileSize = 'xl' | 'md' | 'sm';

export interface ParticipantTileHostAction {
  action: MeetingHostTileAction;
  userId: string;
}

/**
 * F5 (T-51) — Tile ÚNICO de participante: galería, filmstrip, spotlight y mini-player (principal y
 * miniaturas) pintan el mismo componente; solo cambia `size`.
 *
 *   <app-meeting-participant-tile [participant]="p" [stream]="cameraStreamFor(p.userId)" size="xl"
 *     [isSelf]="false" [isSpeaking]="isSpeaking(p.userId)" [levelBars]="barsOf(p.userId)" [pinned]="pinned() === p.userId"
 *     [canHostAct]="isHost()" [canMakeHost]="isPrimaryHost()" [reaction]="reactionFor(p.userId)" [nowMs]="now()"
 *     [clickable]="true" (spotlight)="toggleSpotlight(p.userId)" (hostAction)="hostAction($event)" />
 *
 * Overlays: nombre ("You" si `isSelf`), mic apagado, cámara apagada → `app-avatar` con la foto
 * (`avatarUrl`), ✋ con "Hand raised · 2m ago" en el tooltip, rol (Host / Co-host), anillo animado +
 * medidor de 3 barras al hablar (`levelBars` 0–3), `app-quality-badge` (`showMetrics` + `metrics`
 * solo para el propio tile del staff), icono de pantalla compartida, "Pinned" y la burbuja de reacción.
 * Menú de host (`canHostAct`): Make co-host / Remove co-host / Make host (`canMakeHost` = solo el
 * host principal) / Lower hand / Remove — el padre ejecuta `hostAction` por nombre. Los roles solo se
 * ofrecen a staff (`isRoleEligible`). En `sm` el menú es un icono y los badges iconos con tooltip.
 * `clickable` → click en el tile emite `spotlight` (el menú no lo dispara).
 */
@Component({
  selector: 'app-meeting-participant-tile',
  imports: [NgClass, NgTemplateOutlet, AvatarComponent, AvatarUrlPipe, TooltipDirective, DropdownMenuComponent, MenuItemDirective, SrcObjectDirective, QualityBadgeComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block h-full w-full min-h-0 min-w-0' },
  templateUrl: './participant-tile.component.html',
})
export class MeetingParticipantTileComponent {
  readonly participant = input.required<MeetingParticipantDto>();
  readonly stream = input<MediaStream | null>(null);
  readonly size = input<ParticipantTileSize>('xl');
  readonly isSelf = input(false);
  readonly isSpeaking = input(false);
  /** Barras del medidor (0–3). */
  readonly levelBars = input(0);
  readonly pinned = input(false);
  readonly canHostAct = input(false);
  /** "Make host" solo para el host principal (INV-07). */
  readonly canMakeHost = input(false);
  readonly showMetrics = input(false);
  readonly metrics = input<QualityMetrics | null>(null);
  readonly reaction = input<MeetingReaction | null>(null);
  /** Reloj para el "hace X" de la mano (pásale un signal que avance). */
  readonly nowMs = input<number>(Date.now());
  readonly videoPausedByNetwork = input(false);
  readonly clickable = input(false);
  /** Espejo horizontal (mi cámara). */
  readonly mirror = input<boolean | null>(null);

  readonly spotlight = output<void>();
  readonly hostAction = output<ParticipantTileHostAction>();

  protected readonly BARS = [1, 2, 3] as const;

  readonly showVideo = computed(() => this.participant().videoEnabled && !!this.stream());
  readonly mirrored = computed(() => this.mirror() ?? this.isSelf());
  readonly displayName = computed(() => (this.isSelf() ? 'You' : this.participant().displayName));
  readonly roleLabel = computed(() => {
    const role = this.participant().role;
    return role === 'Host' ? 'Host' : role === 'Cohost' ? 'Co-host' : null;
  });
  readonly handLabel = computed(() => {
    const p = this.participant();
    if (!p.handRaised) {
      return null;
    }
    const rel = formatRelativeTime(p.handRaisedAtUtc, this.nowMs());
    return rel ? `Hand raised · ${rel.toLowerCase() === 'just now' ? 'just now' : rel}` : 'Hand raised';
  });
  readonly roleEligible = computed(() => isRoleEligible(this.participant()));
  readonly isSm = computed(() => this.size() === 'sm');
  /** Duración de la burbuja de reacción (variable CSS de la animación). */
  readonly reactionMs = computed(() => {
    const r = this.reaction();
    return r ? `${Math.max(0, r.expiresAtMs - r.shownAtMs)}ms` : null;
  });
  /** Lista de 0/1 elementos con `track r.id` para que cada reacción nueva re-dispare la animación. */
  readonly reactionList = computed(() => {
    const r = this.reaction();
    return r ? [r] : [];
  });

  readonly ringClass = computed(() => {
    if (this.isSpeaking()) {
      return 'ring-emerald-400 tv-speaking-ring';
    }
    return this.pinned() ? 'ring-brand-bold' : 'ring-transparent';
  });

  readonly radiusClass = computed(() => (this.size() === 'xl' ? 'rounded-2xl' : this.size() === 'md' ? 'rounded-xl' : 'rounded-lg'));
  readonly avatarSize = computed(() => (this.size() === 'xl' ? 'xl' : this.size() === 'md' ? 'md' : 'xs') as 'xl' | 'md' | 'xs');
  readonly namePillClass = computed(() =>
    this.size() === 'xl' ? 'bottom-2 left-2 gap-1.5 px-2.5 py-1 text-[0.6875rem]' : 'bottom-1 left-1 gap-1 px-2 py-0.5 text-[0.625rem]',
  );
  readonly cornerClass = computed(() => (this.size() === 'xl' ? 'top-2' : 'top-1'));
  readonly menuButtonClass = computed(() => (this.size() === 'xl' ? 'h-8 w-8 text-sm' : this.size() === 'md' ? 'h-7 w-7 text-sm' : 'h-5 w-5 text-[0.625rem]'));

  protected onTileClick(): void {
    if (this.clickable()) {
      this.spotlight.emit();
    }
  }

  protected act(action: MeetingHostTileAction): void {
    this.hostAction.emit({ action, userId: this.participant().userId });
  }

  protected barHeight(bar: number): string {
    return bar === 1 ? 'h-1' : bar === 2 ? 'h-2' : 'h-3';
  }
}
