import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, input, output } from '@angular/core';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ActiveMeetingService, MeetingHostTileAction } from '../../active-meeting.service';
import { isRoleEligible } from '../../meeting-participants.util';
import type { MeetingParticipantDto } from '../../meeting.model';

/**
 * F5 (D-49) — Panel "Participants" (drawer): cola "Raised hands (N)" ordenada por `handRaisedAtUtc`
 * con "Lower" por fila y "Lower all" (host/cohost), lista completa con las acciones de host del tile,
 * sala de espera (Admit / Deny) e "Invite" (F6: solo host/cohost; emite `invite` y la sala abre su panel
 * de invitaciones — core no importa features).
 *
 *   @defer (when participantsOpen()) {
 *     <app-meeting-participants-panel [isOpen]="participantsOpen()" [canInvite]="!guestMode"
 *       (closed)="participantsOpen.set(false)" (invite)="openInvite()" />
 *   }
 *
 * Lee `ActiveMeetingService` directamente (vive en core; la sala y el mini-player solo lo abren).
 */
@Component({
  selector: 'app-meeting-participants-panel',
  imports: [DrawerComponent, AvatarComponent, AvatarUrlPipe, TooltipDirective, StatusPillComponent, DropdownMenuComponent, MenuItemDirective, TimeAgoPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './participants-panel.component.html',
})
export class MeetingParticipantsPanelComponent {
  private readonly meeting = inject(ActiveMeetingService);

  readonly isOpen = input(false);
  /** F6 — el pie "Invite" (además de ser host): false en la sala de invitado. */
  readonly canInvite = input(true);
  readonly closed = output<void>();
  /** F6 — el host pulsó "Invite": el padre abre el panel de invitaciones. */
  readonly invite = output<void>();

  readonly isHost = this.meeting.isHost;
  readonly isPrimaryHost = this.meeting.isPrimaryHost;
  readonly myUserId = this.meeting.myUserId;
  readonly nowMs = this.meeting.nowMs;
  readonly raisedHands = this.meeting.raisedHands;
  readonly waiting = this.meeting.waitingParticipants;
  /** Dentro: yo primero, luego por orden de entrada (el roster ya viene ordenado). */
  readonly joined = computed(() => {
    const me = this.myUserId();
    const list = this.meeting.joinedParticipants();
    return [...list.filter(p => p.userId === me), ...list.filter(p => p.userId !== me)];
  });
  readonly handRaised = this.meeting.handRaised;

  roleTone(p: MeetingParticipantDto): 'brand' | 'info' | null {
    return p.role === 'Host' ? 'brand' : p.role === 'Cohost' ? 'info' : null;
  }

  roleLabel(p: MeetingParticipantDto): string {
    return p.role === 'Host' ? 'Host' : 'Co-host';
  }

  isMe(p: MeetingParticipantDto): boolean {
    return p.userId === this.myUserId();
  }

  eligible(p: MeetingParticipantDto): boolean {
    return isRoleEligible(p);
  }

  act(action: MeetingHostTileAction, p: MeetingParticipantDto): void {
    this.meeting.performHostAction(action, p.userId);
  }

  lowerAll(): void {
    this.meeting.lowerAllHands();
  }

  lowerMine(): void {
    if (this.handRaised()) {
      void this.meeting.toggleHandRaise();
    }
  }
}
