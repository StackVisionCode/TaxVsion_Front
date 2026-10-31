import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output, signal } from '@angular/core';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { ReactionPickerComponent } from '@core/communication/ui/reaction-picker/reaction-picker.component';
import type { ChatParticipant, MessageReactionSummary } from '../chat-message.model';

/** Tamaño de la barra rápida (ADD-07 H-2): los primeros del catálogo curado. */
const QUICK_BAR_SIZE = 6;
/** Fotos visibles en "quién reaccionó"; el resto se resume. */
const WHO_MAX = 8;

/**
 * F8d (T-26, ADD-07 H-2, INV-10 H-4): reacciones de un mensaje. Chips con contador y `aria-pressed` (la mía
 * resaltada), "quién reaccionó" con foto al pasar el mouse o enfocar, barra rápida de 6 y picker curado (T-24)
 * con el resto. Con el tope de emojis por persona alcanzado (D-24) los nuevos quedan deshabilitados.
 * Presentacional: emite el emoji y el padre decide agregar o quitar.
 */
@Component({
  selector: 'app-message-reactions',
  imports: [AvatarComponent, AvatarUrlPipe, ReactionPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-1 flex flex-wrap items-center gap-1" [class.justify-end]="alignEnd()" data-role="message-reactions">
      @for (reaction of reactions(); track reaction.emoji) {
        <span class="group/chip relative">
          <button type="button" (click)="toggled.emit(reaction.emoji)" [disabled]="!canReact()"
            [attr.aria-pressed]="mine(reaction)" [attr.aria-label]="reaction.emoji + ' ' + reaction.count + (mine(reaction) ? ', you reacted' : '')"
            class="flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors disabled:cursor-default"
            [class]="mine(reaction) ? 'border-brand-bold/40 bg-brand-bold/10 text-brand-bold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'"
            data-role="reaction-chip">
            <span aria-hidden="true">{{ reaction.emoji }}</span><span class="tabular-nums">{{ reaction.count }}</span>
          </button>
          <!-- Quién reaccionó (con foto) -->
          <span role="tooltip" class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-56 -translate-x-1/2 rounded-xl bg-gray-900 px-2.5 py-2 text-left text-xs text-white shadow-lg group-hover/chip:block group-focus-within/chip:block" data-role="reaction-who">
            @for (person of who(reaction); track person.userId) {
              <span class="flex items-center gap-1.5 py-0.5">
                <app-avatar [name]="person.displayName" [seed]="person.userId" [imageUrl]="person.avatarFileId | avatarUrl" sizeClass="h-4 w-4 text-[0.5rem]"></app-avatar>
                <span class="truncate">{{ person.userId === currentUserId() ? 'You' : person.displayName }}</span>
              </span>
            }
            @if (reaction.userIds.length > whoMax) {
              <span class="block pt-0.5 text-gray-300">and {{ reaction.userIds.length - whoMax }} more</span>
            }
          </span>
        </span>
      }

      @if (canReact() && catalog().length > 0) {
        <span class="relative" [class.hidden]="!barOpen() && reactions().length === 0 && !hoverReveal()">
          <button type="button" (click)="localOpen.set(!barOpen())" aria-label="Add reaction" [attr.aria-expanded]="barOpen()"
            class="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700" data-role="reaction-add">
            <ion-icon name="happy-outline" class="text-sm"></ion-icon>
          </button>
          @if (barOpen()) {
            <span class="absolute bottom-full z-30 mb-1 flex items-center gap-0.5 rounded-full border border-gray-100 bg-white p-1 shadow-lg"
              [class]="alignEnd() ? 'right-0' : 'left-0'" role="toolbar" aria-label="Quick reactions" data-role="reaction-bar">
              @for (emoji of quick(); track emoji) {
                <button type="button" (click)="pick(emoji)" [disabled]="blocked(emoji)" [attr.aria-label]="'React with ' + emoji"
                  [attr.title]="blocked(emoji) ? limitText() : null"
                  class="flex h-8 w-8 items-center justify-center rounded-full text-lg hover:bg-gray-100 disabled:opacity-30">{{ emoji }}</button>
              }
              @if (catalog().length > quick().length) {
                <span class="relative">
                  <button type="button" (click)="pickerOpen.set(!pickerOpen())" aria-label="More reactions"
                    class="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
                    <ion-icon name="add-outline" class="text-base"></ion-icon>
                  </button>
                  @if (pickerOpen()) {
                    <app-reaction-picker [catalog]="pickerCatalog()" (picked)="pick($event)" (closed)="pickerOpen.set(false)" />
                  }
                </span>
              }
            </span>
          }
        </span>
      }
    </div>
  `,
})
export class MessageReactionsComponent {
  readonly reactions = input<readonly MessageReactionSummary[]>([]);
  readonly catalog = input<readonly string[]>([]);
  readonly participants = input<readonly ChatParticipant[]>([]);
  readonly currentUserId = input<string | null>(null);
  readonly canReact = input(false);
  /** D-24: emojis distintos por persona y mensaje. */
  readonly maxPerUser = input(3);
  readonly alignEnd = input(false);
  /** El padre abre la barra (pulsación larga en móvil). */
  readonly open = input(false);
  /** Mostrar el botón de agregar aunque no haya reacciones (hover del mensaje). */
  readonly hoverReveal = input(false);
  readonly toggled = output<string>();

  protected readonly whoMax = WHO_MAX;
  protected readonly localOpen = signal(false);
  protected readonly pickerOpen = signal(false);
  protected readonly barOpen = computed(() => this.localOpen() || this.open());

  protected readonly quick = computed(() => this.catalog().slice(0, QUICK_BAR_SIZE));
  protected readonly pickerCatalog = computed(() => this.catalog().slice(QUICK_BAR_SIZE));
  private readonly myEmojis = computed(() => {
    const me = this.currentUserId();
    return new Set(this.reactions().filter(r => !!me && r.userIds.includes(me)).map(r => r.emoji));
  });
  protected readonly limitText = computed(() => `You can add up to ${this.maxPerUser()} reactions to a message.`);

  protected mine(reaction: MessageReactionSummary): boolean {
    return this.myEmojis().has(reaction.emoji);
  }

  /** Un emoji nuevo con el tope alcanzado no se ofrece (quitar uno propio siempre se puede). */
  protected blocked(emoji: string): boolean {
    return !this.myEmojis().has(emoji) && this.myEmojis().size >= this.maxPerUser();
  }

  protected who(reaction: MessageReactionSummary): ChatParticipant[] {
    const byId = new Map(this.participants().map(p => [p.userId, p]));
    return reaction.userIds.slice(0, WHO_MAX).map(id => byId.get(id) ?? { userId: id, displayName: 'Someone' });
  }

  protected pick(emoji: string): void {
    if (this.blocked(emoji)) {
      return;
    }
    this.toggled.emit(emoji);
    this.localOpen.set(false);
    this.pickerOpen.set(false);
  }
}
