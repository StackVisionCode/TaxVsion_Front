import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';

/**
 * Tarjeta de una conexión de terceros (proveedor de IA o cuenta OAuth) en Connections & MCP.
 * Presentacional: el padre decide qué pasa en cada evento.
 *
 * Sin conectar: botón "Connect". Conectada: interruptor on/off, líneas de detalle (`meta`) y
 * acciones "Manage" / "Disconnect".
 */
@Component({
  selector: 'app-connection-card',
  imports: [NgClass, SwitchComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="flex h-full flex-col rounded-2xl border border-gray-100 p-4 transition-colors"
      [ngClass]="connected ? 'bg-white' : 'hover:bg-gray-50'">
      <div class="flex items-start justify-between gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" [ngClass]="circleClass">
          <ion-icon [name]="icon" class="text-lg"></ion-icon>
        </span>
        @if (connected) {
          <app-switch size="sm" [checked]="enabled" [busy]="busy" (checkedChange)="toggled.emit($event)"
            [ariaLabel]="'Enable ' + name"></app-switch>
        }
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <p class="text-sm font-bold text-gray-900">{{ name }}</p>
        @if (connected) {
          <app-status-pill [tone]="enabled ? 'success' : 'neutral'" [soft]="true" size="xs">
            {{ enabled ? 'Connected' : 'Paused' }}
          </app-status-pill>
        }
      </div>
      <p class="mt-0.5 text-xs leading-snug text-gray-400">{{ description }}</p>

      @if (connected && meta.length > 0) {
        <div class="mt-3 flex flex-col gap-0.5 border-t border-gray-100 pt-3">
          @for (line of meta; track line) {
            <p class="truncate text-xs text-gray-500">{{ line }}</p>
          }
        </div>
      }

      <div class="mt-auto flex flex-wrap items-center gap-2 pt-4">
        @if (connected) {
          <button type="button" (click)="manage.emit()" [disabled]="busy"
            class="rounded-full border border-gray-200 px-4 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Manage
          </button>
          <button type="button" (click)="disconnect.emit()" [disabled]="busy"
            class="rounded-full border border-red-200 px-4 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
            Disconnect
          </button>
        } @else {
          <button type="button" (click)="connect.emit()" [disabled]="busy"
            class="flex items-center gap-1.5 rounded-full bg-brand-bold px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-ink disabled:opacity-50 transition-colors">
            <ion-icon name="link-outline" class="text-sm"></ion-icon>
            Connect
          </button>
        }
      </div>
    </div>
  `,
})
export class ConnectionCardComponent {
  @Input({ required: true }) name = '';
  @Input() description = '';
  @Input() icon = 'link-outline';
  @Input() circleClass = 'bg-gray-200 text-gray-700';
  @Input() connected = false;
  @Input() enabled = false;
  @Input() busy = false;
  /** Líneas de detalle cuando está conectada (key, modelo, permisos…). */
  @Input() meta: readonly string[] = [];

  @Output() readonly connect = new EventEmitter<void>();
  @Output() readonly manage = new EventEmitter<void>();
  @Output() readonly disconnect = new EventEmitter<void>();
  @Output() readonly toggled = new EventEmitter<boolean>();
}
