import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/** Barra de reacciones rápidas (presentacional): emite el emoji elegido. */
@Component({
  selector: 'app-meeting-reaction-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-5 gap-1 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl" role="menu" aria-label="Send a reaction">
      @for (r of reactions; track r.emoji) {
        <button type="button" role="menuitem" (click)="picked.emit(r.emoji)" [title]="r.label" [attr.aria-label]="r.label"
          class="reaction-btn flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-gray-100 focus-visible:bg-gray-100 transition-transform motion-reduce:transition-none">
          {{ r.emoji }}
        </button>
      }
    </div>
  `,
  styles: `
    .reaction-btn:hover {
      transform: scale(1.18);
    }
    @media (prefers-reduced-motion: reduce) {
      .reaction-btn:hover {
        transform: none;
      }
    }
  `,
})
export class MeetingReactionPickerComponent {
  @Input() reactions: readonly { emoji: string; label: string }[] = [];
  @Output() picked = new EventEmitter<string>();
}
