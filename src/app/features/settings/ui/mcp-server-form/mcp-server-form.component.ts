import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import {
  MCP_AUTH_LABELS,
  MCP_TRANSPORT_LABELS,
  McpAuthType,
  McpServer,
  McpServerDraft,
  McpTransport,
  isValidMcpUrl,
} from '../../data-access/connections.model';

/**
 * Alta / edición de un servidor MCP remoto (cuerpo del drawer en Connections & MCP).
 * Emite `(saved)` con un `McpServerDraft`; con `server` (edición) el token vacío = conservar.
 */
@Component({
  selector: 'app-mcp-server-form',
  imports: [FormsModule, SegmentedComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <form class="flex flex-col gap-5" (ngSubmit)="submit()">
      <div>
        <label for="mcpName" class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Name</label>
        <input id="mcpName" name="name" type="text" placeholder="e.g. Firm knowledge base" maxlength="60"
          [disabled]="saving" [ngModel]="name()" (ngModelChange)="name.set($event)"
          class="mt-2 h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-300 focus:outline-none transition-colors" />
      </div>

      <div>
        <label for="mcpUrl" class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Server URL</label>
        <input id="mcpUrl" name="url" type="url" placeholder="https://mcp.example.com/mcp" autocomplete="off"
          [disabled]="saving" [ngModel]="url()" (ngModelChange)="url.set($event)"
          class="mt-2 h-11 w-full rounded-full border bg-white px-4 text-sm text-gray-700 placeholder-gray-400 focus:outline-none transition-colors"
          [class]="urlError() ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-gray-300'" />
        @if (urlError()) {
          <p class="mt-1.5 text-xs text-red-500">Use an https:// URL (http is only allowed for localhost).</p>
        } @else {
          <p class="mt-1.5 text-xs text-gray-400">Only remote servers are supported. Local (stdio) servers can't run in the browser.</p>
        }
      </div>

      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Transport</p>
        <app-segmented class="mt-2" [options]="transportOptions" [value]="transport()" (valueChange)="transport.set($event)"></app-segmented>
      </div>

      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Authentication</p>
        <app-segmented class="mt-2" [options]="authOptions" [value]="authType()" (valueChange)="authType.set($event)"></app-segmented>

        @if (authType() === 'bearer') {
          <input name="token" type="password" autocomplete="off"
            [placeholder]="server?.tokenHint ? 'Leave empty to keep ' + server?.tokenHint : 'Paste the access token'"
            [disabled]="saving" [ngModel]="token()" (ngModelChange)="token.set($event)"
            class="mt-3 h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-300 focus:outline-none transition-colors" />
        }
        @if (authType() === 'oauth') {
          <p class="mt-3 text-xs text-gray-400">You'll be asked to sign in to the server the first time the assistant uses it.</p>
        }
      </div>

      <div class="flex justify-end gap-2 border-t border-gray-100 pt-4">
        <button type="button" (click)="cancelled.emit()" [disabled]="saving"
          class="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Cancel
        </button>
        <button type="submit" [disabled]="saving || !canSubmit()"
          class="flex items-center gap-2 rounded-full bg-brand-bold px-4 py-2 text-sm font-semibold text-white hover:bg-brand-ink disabled:opacity-50 transition-colors">
          @if (saving) {
            <ion-icon name="sync-outline" class="animate-spin text-base"></ion-icon>
          }
          {{ server ? 'Save changes' : 'Add server' }}
        </button>
      </div>
    </form>
  `,
})
export class McpServerFormComponent implements OnInit {
  @Input() server: McpServer | null = null;
  @Input() saving = false;

  @Output() readonly saved = new EventEmitter<McpServerDraft>();
  @Output() readonly cancelled = new EventEmitter<void>();

  readonly transportOptions: SegmentedOption<McpTransport>[] = (['http', 'sse'] as const).map(id => ({
    id,
    label: MCP_TRANSPORT_LABELS[id],
  }));
  readonly authOptions: SegmentedOption<McpAuthType>[] = (['none', 'bearer', 'oauth'] as const).map(id => ({
    id,
    label: MCP_AUTH_LABELS[id],
  }));

  readonly name = signal('');
  readonly url = signal('');
  readonly transport = signal<McpTransport>('http');
  readonly authType = signal<McpAuthType>('none');
  readonly token = signal('');

  /** Solo se marca error cuando ya hay algo escrito. */
  readonly urlError = computed(() => !!this.url().trim() && !isValidMcpUrl(this.url()));

  readonly canSubmit = computed(() => {
    if (!this.name().trim() || !isValidMcpUrl(this.url())) {
      return false;
    }
    // Bearer nuevo (o que antes no era bearer) necesita token; al editar uno existente se conserva.
    const keepsToken = this.server?.authType === 'bearer' && !!this.server.tokenHint;
    return this.authType() !== 'bearer' || !!this.token().trim() || keepsToken;
  });

  ngOnInit(): void {
    if (this.server) {
      this.name.set(this.server.name);
      this.url.set(this.server.url);
      this.transport.set(this.server.transport);
      this.authType.set(this.server.authType);
    }
  }

  submit(): void {
    if (this.saving || !this.canSubmit()) {
      return;
    }
    this.saved.emit({
      id: this.server?.id ?? null,
      name: this.name(),
      url: this.url(),
      transport: this.transport(),
      authType: this.authType(),
      token: this.token(),
    });
  }
}
