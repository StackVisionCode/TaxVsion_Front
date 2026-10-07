import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AiProviderConnection,
  AiProviderCredentials,
  AiProviderDefinition,
} from '../../data-access/connections.model';

/**
 * Formulario de API key de un proveedor de IA (cuerpo del drawer en Connections & MCP).
 * Presentacional: emite `(saved)` con las credenciales y `(cancelled)`.
 *
 * Con `connection` (edición) la key es opcional: vacía = se conserva la actual, y se muestra su
 * pista. Se crea de nuevo en cada apertura del drawer, así que los valores salen de los inputs en
 * `ngOnInit`.
 */
@Component({
  selector: 'app-ai-provider-form',
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <form class="flex flex-col gap-5" (ngSubmit)="submit()">
      <div>
        <label for="aiApiKey" class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">API key</label>
        <div class="relative mt-2">
          <input id="aiApiKey" name="apiKey" [type]="showKey() ? 'text' : 'password'" autocomplete="off"
            [placeholder]="connection ? 'Leave empty to keep ' + connection.keyHint : provider.keyPlaceholder"
            [disabled]="saving" [ngModel]="apiKey()" (ngModelChange)="apiKey.set($event)"
            class="h-11 w-full rounded-full border border-gray-200 bg-white pl-4 pr-11 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-300 focus:outline-none transition-colors" />
          <button type="button" (click)="showKey.set(!showKey())"
            [attr.aria-label]="showKey() ? 'Hide API key' : 'Show API key'"
            class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <ion-icon [name]="showKey() ? 'eye-off-outline' : 'eye-outline'" class="text-base"></ion-icon>
          </button>
        </div>
        <p class="mt-1.5 text-xs text-gray-400">
          Create a key in your
          <a [href]="provider.docsUrl" target="_blank" rel="noopener" class="font-semibold text-brand-bold hover:underline">{{ provider.name }} console</a>.
          It's stored encrypted and never shown again.
        </p>
      </div>

      @if (provider.requiresEndpoint) {
        <div>
          <label for="aiEndpoint" class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Endpoint</label>
          <input id="aiEndpoint" name="endpoint" type="url" placeholder="https://your-resource.openai.azure.com"
            [disabled]="saving" [ngModel]="endpoint()" (ngModelChange)="endpoint.set($event)"
            class="mt-2 h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-300 focus:outline-none transition-colors" />
        </div>
      }

      <div>
        <label for="aiModel" class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {{ provider.requiresEndpoint ? 'Deployment' : 'Default model (optional)' }}
        </label>
        <input id="aiModel" name="defaultModel" type="text" [placeholder]="provider.modelPlaceholder"
          [disabled]="saving" [ngModel]="defaultModel()" (ngModelChange)="defaultModel.set($event)"
          class="mt-2 h-11 w-full rounded-full border border-gray-200 bg-white px-4 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-300 focus:outline-none transition-colors" />
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
          {{ connection ? 'Save changes' : 'Connect' }}
        </button>
      </div>
    </form>
  `,
})
export class AiProviderFormComponent implements OnInit {
  @Input({ required: true }) provider!: AiProviderDefinition;
  @Input() connection: AiProviderConnection | null = null;
  @Input() saving = false;

  @Output() readonly saved = new EventEmitter<AiProviderCredentials>();
  @Output() readonly cancelled = new EventEmitter<void>();

  readonly apiKey = signal('');
  readonly defaultModel = signal('');
  readonly endpoint = signal('');
  readonly showKey = signal(false);

  readonly canSubmit = computed(() => {
    const hasKey = !!this.apiKey().trim() || !!this.connection;
    const hasEndpoint = !this.provider.requiresEndpoint || !!this.endpoint().trim();
    const hasDeployment = !this.provider.requiresEndpoint || !!this.defaultModel().trim();
    return hasKey && hasEndpoint && hasDeployment;
  });

  ngOnInit(): void {
    this.defaultModel.set(this.connection?.defaultModel ?? '');
    this.endpoint.set(this.connection?.endpoint ?? '');
  }

  submit(): void {
    if (this.saving || !this.canSubmit()) {
      return;
    }
    this.saved.emit({
      providerId: this.provider.id,
      apiKey: this.apiKey(),
      defaultModel: this.defaultModel(),
      endpoint: this.endpoint(),
    });
  }
}
