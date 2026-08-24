import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SmsContactListItem } from '../../data-access/sms.model';

/**
 * Rail de contactos del módulo SMS (estilo "Aether"). Con el backend real cada fila
 * es un CLIENTE del despacho (GET /customers) y no una "conversación": el servicio
 * SMS no expone historial ni hilos, así que la vista previa sale de los mensajes
 * enviados en esta sesión. Se quitó el badge de no leídos: no existe endpoint de
 * mensajes entrantes que lo respalde. Los clientes sin teléfono se muestran
 * atenuados (no se les puede textear) para que el usuario entienda por qué faltan.
 * Incluye un buscador local (píldora) que filtra por nombre o teléfono.
 */
@Component({
  selector: 'app-sms-conversation-list',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-conversation-list.component.html',
})
export class SmsConversationListComponent {
  @Input() contacts: SmsContactListItem[] = [];
  @Input() selectedId: string | null = null;
  @Output() contactSelected = new EventEmitter<string>();

  readonly search = signal('');

  get filteredContacts(): SmsContactListItem[] {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.contacts;
    }
    return this.contacts.filter(
      contact =>
        contact.name.toLowerCase().includes(term) || contact.phoneRaw.toLowerCase().includes(term),
    );
  }

  select(id: string): void {
    this.contactSelected.emit(id);
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
