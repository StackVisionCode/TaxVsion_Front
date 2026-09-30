import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Mensaje del chat del meeting ya resuelto para la vista (con el rol del remitente, si tiene). */
export interface MeetingChatViewMessage {
  id: string;
  senderName: string;
  /** 'Host' | 'Co-host' | null — se resuelve contra el roster en la sala. */
  senderRole: string | null;
  text: string;
  time: string;
  isMine: boolean;
}

/** Panel de chat del meeting (presentacional): lista + composer. Autoscroll al llegar mensajes. */
@Component({
  selector: 'app-meeting-chat-panel',
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting-chat-panel.component.html',
})
export class MeetingChatPanelComponent implements AfterViewChecked {
  @Input() messages: MeetingChatViewMessage[] = [];

  @Output() send = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('scroller') private scroller?: ElementRef<HTMLElement>;

  readonly draft = signal('');
  private lastCount = 0;

  ngAfterViewChecked(): void {
    // Solo al cambiar la cantidad (no en cada CD) para no pelear con el scroll manual del usuario.
    if (this.messages.length !== this.lastCount && this.scroller) {
      this.lastCount = this.messages.length;
      const el = this.scroller.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  submit(): void {
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
  }
}
