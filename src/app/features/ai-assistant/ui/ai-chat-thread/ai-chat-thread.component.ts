import { AfterViewChecked, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  time: string;
}

/**
 * Hilo de mensajes del AI Assistant (estilo "Aether"): burbujas negras
 * alineadas a la derecha para el usuario, blancas con icono sparkles para la
 * IA. Auto-scroll al fondo cuando llegan mensajes nuevos.
 */
@Component({
  selector: 'app-ai-chat-thread',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './ai-chat-thread.component.html',
  styleUrl: './ai-chat-thread.component.css',
})
export class AiChatThreadComponent implements AfterViewChecked {
  @Input() messages: AiChatMessage[] = [];
  @Input() isTyping = false;

  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;

  ngAfterViewChecked(): void {
    this.scrollAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}
