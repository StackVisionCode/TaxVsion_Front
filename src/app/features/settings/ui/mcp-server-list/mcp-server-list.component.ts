import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { MCP_AUTH_LABELS, MCP_TRANSPORT_LABELS, McpServer } from '../../data-access/connections.model';

/**
 * Lista de servidores MCP conectados, con estado vacío. Presentacional: emite `(add)`, `(edit)`,
 * `(remove)` y `(toggled)`; `busyId` pone en "busy" el interruptor de la fila que se guarda.
 */
@Component({
  selector: 'app-mcp-server-list',
  imports: [SwitchComponent, StatusPillComponent, DropdownMenuComponent, MenuItemDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (servers.length === 0) {
      <div class="flex flex-col items-center rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-brand-bold">
          <ion-icon name="extension-puzzle-outline" class="text-xl"></ion-icon>
        </span>
        <p class="mt-3 text-sm font-bold text-gray-900">No MCP servers yet</p>
        <p class="mt-1 max-w-sm text-xs leading-relaxed text-gray-400">
          MCP (Model Context Protocol) servers give the assistant extra tools and data — your document system,
          an internal knowledge base or any service that exposes an MCP endpoint.
        </p>
        <button type="button" (click)="add.emit()"
          class="mt-4 flex items-center gap-1.5 rounded-full bg-brand-bold px-4 py-2 text-xs font-semibold text-white hover:bg-brand-ink transition-colors">
          <ion-icon name="add-outline" class="text-sm"></ion-icon>
          Add server
        </button>
      </div>
    } @else {
      <div class="flex flex-col divide-y divide-gray-100 rounded-2xl border border-gray-100">
        @for (server of servers; track server.id) {
          <div class="flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-brand-bold">
              <ion-icon name="server-outline" class="text-base"></ion-icon>
            </span>
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                {{ server.name }}
                <app-status-pill [tone]="server.enabled ? 'success' : 'neutral'" [soft]="true" size="xs">
                  {{ server.enabled ? 'Enabled' : 'Disabled' }}
                </app-status-pill>
              </p>
              <p class="mt-0.5 truncate text-xs text-gray-400">
                {{ server.url }} · {{ transportLabels[server.transport] }} · {{ authLabels[server.authType] }}
                @if (server.tokenHint) {
                  <span>({{ server.tokenHint }})</span>
                }
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <app-switch size="sm" [checked]="server.enabled" [busy]="busyId === server.id"
                (checkedChange)="toggled.emit({ id: server.id, enabled: $event })"
                [ariaLabel]="'Enable ' + server.name"></app-switch>
              <app-dropdown-menu [ariaLabel]="'Actions for ' + server.name">
                <button appMenuItem type="button" (click)="edit.emit(server)">
                  <ion-icon name="create-outline" class="text-base"></ion-icon> Edit
                </button>
                <button appMenuItem [danger]="true" type="button" (click)="remove.emit(server)">
                  <ion-icon name="trash-outline" class="text-base"></ion-icon> Remove
                </button>
              </app-dropdown-menu>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class McpServerListComponent {
  @Input() servers: readonly McpServer[] = [];
  @Input() busyId: string | null = null;

  @Output() readonly add = new EventEmitter<void>();
  @Output() readonly edit = new EventEmitter<McpServer>();
  @Output() readonly remove = new EventEmitter<McpServer>();
  @Output() readonly toggled = new EventEmitter<{ id: string; enabled: boolean }>();

  readonly transportLabels = MCP_TRANSPORT_LABELS;
  readonly authLabels = MCP_AUTH_LABELS;
}
