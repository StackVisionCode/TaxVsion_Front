import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, Input, OnChanges, SimpleChanges, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { ATTACHMENT_STATE_LABELS, toAttachmentScanState } from '@shared/ui/chat/chat-message.model';
import { formatBytes } from '@shared/utils/format.util';
import { ChatService } from '../../data-access/chat.service';
import { ChatSocketService } from '../../data-access/chat-socket.service';
import type { ConversationContentItem, ConversationContentTab } from '../../data-access/chat.model';

/**
 * F8d (ADD-01 §13): pestañas de Info por tipo REAL del archivo (Media, Files, Audio) y enlaces, paginadas desde el
 * servidor (más reciente primero). Un adjunto que el escaneo rechaza se quita en vivo (`attachment_flagged`).
 */
@Component({
  selector: 'app-conversation-content-tabs',
  imports: [CommonModule, SegmentedComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="mt-5" data-role="content-tabs">
      <app-segmented [options]="tabs" [value]="tab()" (valueChange)="selectTab($event)"></app-segmented>
      <ul class="mt-3 flex flex-col gap-2" data-role="content-items">
        @for (item of items(); track trackId(item)) {
          <li>
            @if (item.kind === 'Link') {
              <a [href]="item.url" target="_blank" rel="noopener noreferrer" data-role="content-link"
                class="flex items-center gap-3 rounded-2xl border border-gray-100 p-3 hover:bg-gray-50 transition-colors">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100">
                  <ion-icon name="link-outline" class="text-base text-gray-700"></ion-icon>
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-gray-900">{{ item.domain }}</span>
                  <span class="block truncate text-xs text-gray-400">{{ item.url }}</span>
                </span>
              </a>
            } @else {
              <button type="button" (click)="attachmentOpened.emit({ fileId: item.fileId, name: item.fileName ?? 'Attachment' })"
                [disabled]="item.status !== 'Available'" data-role="content-file"
                class="flex w-full items-center gap-3 rounded-2xl border border-gray-100 p-3 text-left hover:bg-gray-50 transition-colors disabled:cursor-default disabled:hover:bg-white">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100">
                  <ion-icon [name]="iconFor(item.category)" class="text-base text-gray-700"></ion-icon>
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-gray-900">{{ item.fileName ?? 'Attachment' }}</span>
                  <span class="block text-xs" [class.text-gray-400]="item.status !== 'PendingReview'" [class.text-amber-600]="item.status === 'PendingReview'">{{ stateOf(item) }}</span>
                </span>
              </button>
            }
          </li>
        } @empty {
          @if (!loading() && !error()) {
            <li class="px-2 py-4 text-center text-sm text-gray-400">{{ emptyText() }}</li>
          }
        }
      </ul>
      @if (loading()) {
        <p class="py-3 text-center text-xs text-gray-400">Loading…</p>
      }
      @if (error()) {
        <p class="py-3 text-center text-xs text-red-600">Couldn't load this tab.</p>
      }
      @if (nextBefore() && !loading()) {
        <button type="button" (click)="loadMore()" data-role="content-load-more"
          class="mx-auto mt-2 block rounded-full border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Load more</button>
      }
    </div>
  `,
})
export class ConversationContentTabsComponent implements OnChanges {
  private readonly chat = inject(ChatService);
  private readonly socket = inject(ChatSocketService);

  @Input({ required: true }) conversationId!: string;
  readonly attachmentOpened = output<{ fileId: string; name: string }>();

  readonly tabs: SegmentedOption<ConversationContentTab>[] = [
    { id: 'Media', label: 'Media' },
    { id: 'Documents', label: 'Files' },
    { id: 'Audio', label: 'Audio' },
    { id: 'Links', label: 'Links' },
  ];
  readonly tab = signal<ConversationContentTab>('Media');
  readonly items = signal<ConversationContentItem[]>([]);
  readonly nextBefore = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);

  constructor() {
    // Rechazado por el escaneo (infectado, bloqueado o borrado): sale de la lista sin recargar.
    // T-20: en revisión queda como "Under review" y vuelve a disponible si el revisor lo aprueba.
    this.socket.attachmentFlagged$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(flag => {
      if (flag?.conversationId !== this.conversationId) return;
      if (flag.status === 'PendingReview' || flag.status === 'Available') {
        const status = flag.status;
        this.items.update(list => list.map(i => (i.kind === 'Attachment' && i.fileId === flag.fileId ? { ...i, status } : i)));
        return;
      }
      this.items.update(list => list.filter(i => i.kind !== 'Attachment' || i.fileId !== flag.fileId));
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['conversationId'] && this.conversationId) {
      this.load(true);
    }
  }

  selectTab(tab: ConversationContentTab): void {
    if (tab !== this.tab()) {
      this.tab.set(tab);
      this.load(true);
    }
  }

  loadMore(): void {
    this.load(false);
  }

  emptyText(): string {
    switch (this.tab()) {
      case 'Media':
        return 'No photos or videos yet';
      case 'Documents':
        return 'No files yet';
      case 'Audio':
        return 'No voice notes or audio yet';
      default:
        return 'No links yet';
    }
  }

  iconFor(category: string): string {
    return category === 'Image' ? 'image-outline' : category === 'Video' ? 'videocam-outline' : category === 'Audio' ? 'mic-outline' : 'document-outline';
  }

  stateOf(item: { status: string; sizeBytes: number | null }): string {
    const state = toAttachmentScanState(item.status);
    return state === 'Available' ? this.sizeOf(item.sizeBytes) : ATTACHMENT_STATE_LABELS[state];
  }

  sizeOf(bytes: number | null): string {
    return bytes != null ? formatBytes(bytes) : '';
  }

  trackId(item: ConversationContentItem): string {
    return item.kind === 'Link' ? `l:${item.id}` : `a:${item.fileId}`;
  }

  private load(reset: boolean): void {
    const tab = this.tab();
    const conversationId = this.conversationId;
    this.loading.set(true);
    this.error.set(false);
    if (reset) {
      this.items.set([]);
      this.nextBefore.set(null);
    }
    this.chat.getConversationContent(conversationId, tab, reset ? null : this.nextBefore()).subscribe({
      next: page => {
        // Respuesta de una pestaña o conversación que ya no está a la vista: se descarta.
        if (tab !== this.tab() || conversationId !== this.conversationId) {
          return;
        }
        this.items.update(list => (reset ? page.items : [...list, ...page.items]));
        this.nextBefore.set(page.nextBefore);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }
}
