import { AfterViewChecked, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ChatMessage {
  id: string;
  senderId: 'me' | 'them';
  text?: string;
  attachment?: { name: string; size: string };
  time: string;
  dateGroup: string;
}

/**
 * Hilo de mensajes del Chat de equipo (estilo "Aether"): burbujas negras
 * alineadas a la derecha para "mí", blancas con avatar para el otro
 * participante. Soporta un tipo de mensaje simple de adjunto (file chip) y
 * separadores de fecha ("Today"/"Yesterday"). Auto-scroll al fondo cuando
 * llegan mensajes nuevos.
 */
@Component({
  selector: 'app-chat-thread',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-thread.component.html',
})
export class ChatThreadComponent implements AfterViewChecked {
  @Input() messages: ChatMessage[] = [];
  @Input() otherName = '';
  @Input() otherAvatarColor = 'bg-gray-900';

  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;

  ngAfterViewChecked(): void {
    this.scrollAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  showDateSeparator(index: number): boolean {
    if (index === 0) {
      return true;
    }
    return this.messages[index - 1].dateGroup !== this.messages[index].dateGroup;
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  }
}
