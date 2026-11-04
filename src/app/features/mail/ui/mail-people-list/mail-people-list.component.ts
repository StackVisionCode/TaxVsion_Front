import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { avatarColorFor } from '@shared/utils/avatar.util';
import { PersonSearchHit, formatMailTime } from '../../data-access/mail.model';

/**
 * Personas encontradas por la búsqueda de Mail (pestaña People y bloque de All): nombre, dirección,
 * último contacto y cantidad de correos. Pulsar la fila filtra "From"; el menú "…" filtra From/To,
 * abre el redactor o la ficha del cliente. Dumb: el llamador decide qué hace cada acción.
 */
@Component({
  selector: 'app-mail-people-list',
  imports: [AvatarComponent, DropdownMenuComponent, MenuItemDirective, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    @if ((loading && people.length === 0) || (!loading && error)) {
      <app-state-block [loading]="loading" [error]="error" variant="inline" (retry)="retryRequested.emit()" />
    } @else if (people.length === 0) {
      @if (emptyText) {
        <app-state-block [empty]="true" variant="inline" icon="people-outline" [emptyTitle]="emptyText" [emptyMessage]="emptyHint" />
      }
    } @else {
      <ul role="list" class="flex flex-col gap-1" [attr.aria-label]="ariaLabel">
        @for (person of shown(); track person.address) {
          @let label = name(person);
          <li class="flex items-center gap-1 rounded-2xl transition-colors hover:bg-gray-50">
            <button type="button" (click)="filterFrom.emit(person)" [attr.aria-label]="rowLabel(person)"
              class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bold/30">
              <app-avatar [name]="label" [seed]="person.address" size="md" [colorClass]="color(person)" />
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate text-sm font-semibold text-gray-900">{{ label }}</span>
                  @if (person.customerId) {
                    <span class="shrink-0 rounded-full bg-brand-bold/10 px-2 py-0.5 text-[0.625rem] font-semibold text-brand-bold">Client</span>
                  }
                </span>
                @if (label !== person.address) {
                  <span class="block truncate text-xs text-gray-600">{{ person.address }}</span>
                }
                <span class="block truncate text-[0.6875rem] text-gray-400">{{ meta(person) }}</span>
              </span>
            </button>
            <app-dropdown-menu class="mr-2 shrink-0" panelClass="min-w-[12.5rem]" [ariaLabel]="'Actions for ' + label">
              <button appMenuItem type="button" (click)="filterFrom.emit(person)">
                <ion-icon name="mail-outline" class="text-base text-gray-400" aria-hidden="true"></ion-icon> Emails from {{ short(person) }}
              </button>
              <button appMenuItem type="button" (click)="filterTo.emit(person)">
                <ion-icon name="paper-plane-outline" class="text-base text-gray-400" aria-hidden="true"></ion-icon> Emails to {{ short(person) }}
              </button>
              @if (canCompose) {
                <button appMenuItem type="button" (click)="compose.emit(person)">
                  <ion-icon name="create-outline" class="text-base text-gray-400" aria-hidden="true"></ion-icon> Write an email
                </button>
              }
              @if (showClientLink && person.customerId) {
                <button appMenuItem type="button" (click)="openClient.emit(person)">
                  <ion-icon name="person-circle-outline" class="text-base text-gray-400" aria-hidden="true"></ion-icon> Open client profile
                </button>
              }
            </app-dropdown-menu>
          </li>
        }
      </ul>
    }
  `,
})
export class MailPeopleListComponent {
  @Input() people: readonly PersonSearchHit[] = [];
  /** Tope de filas (bloque de All); null = todas. */
  @Input() limit: number | null = null;
  /** Nombre del cliente por id, para quien llega sin nombre visible. */
  @Input() clientNames: ReadonlyMap<string, { displayName: string }> = new Map();
  @Input() canCompose = false;
  @Input() showClientLink = true;
  @Input() loading = false;
  @Input() error: string | null = null;
  /** Vacío = sin estado vacío (el bloque de All simplemente no se pinta). */
  @Input() emptyText = '';
  @Input() emptyHint = '';
  @Input() ariaLabel = 'People';

  @Output() readonly filterFrom = new EventEmitter<PersonSearchHit>();
  @Output() readonly filterTo = new EventEmitter<PersonSearchHit>();
  @Output() readonly compose = new EventEmitter<PersonSearchHit>();
  @Output() readonly openClient = new EventEmitter<PersonSearchHit>();
  @Output() readonly retryRequested = new EventEmitter<void>();

  shown(): readonly PersonSearchHit[] {
    return this.limit === null ? this.people : this.people.slice(0, Math.max(0, this.limit));
  }

  name(person: PersonSearchHit): string {
    return (
      person.displayName?.trim() ||
      (person.customerId ? this.clientNames.get(person.customerId)?.displayName : null) ||
      person.address
    );
  }

  /** Nombre corto para el menú ("Emails from Ana"). */
  short(person: PersonSearchHit): string {
    const name = this.name(person);
    return name === person.address ? name : name.split(/\s+/)[0];
  }

  color(person: PersonSearchHit): string {
    return avatarColorFor(person.address);
  }

  meta(person: PersonSearchHit): string {
    const count = person.messageCount ?? 0;
    const messages = `${count} ${count === 1 ? 'message' : 'messages'}`;
    const last = person.lastContactAtUtc ? formatMailTime(person.lastContactAtUtc) : '';
    return last ? `Last contact ${last} · ${messages}` : messages;
  }

  rowLabel(person: PersonSearchHit): string {
    const name = this.name(person);
    return [
      name,
      name !== person.address ? person.address : null,
      person.customerId ? 'client' : null,
      this.meta(person),
      `show emails from ${this.short(person)}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
}
