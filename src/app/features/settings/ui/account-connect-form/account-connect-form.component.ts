import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { AccountConnection, AccountProviderDefinition } from '../../data-access/connections.model';

/**
 * Consentimiento antes de conectar (o al gestionar) una cuenta de terceros para el asistente.
 * Muestra qué podrá leer y un interruptor para permitir escritura. Emite `(confirmed)` con
 * `allowWrite`.
 *
 * Con backend, "Continue" lleva al consentimiento OAuth del proveedor; hoy el padre solo marca la
 * conexión en memoria (vista previa).
 */
@Component({
  selector: 'app-account-connect-form',
  imports: [SwitchComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="flex flex-col gap-5">
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400">The assistant will be able to</p>
        <ul class="mt-2 flex flex-col gap-2">
          @for (scope of provider.scopes; track scope) {
            <li class="flex items-start gap-2 text-sm text-gray-700">
              <ion-icon name="checkmark-circle" class="mt-0.5 shrink-0 text-base text-emerald-500"></ion-icon>
              {{ scope }}
            </li>
          }
        </ul>
      </div>

      <div class="flex items-start justify-between gap-4 rounded-2xl border border-gray-100 px-4 py-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-900">Allow write actions</p>
          <p class="mt-0.5 text-xs text-gray-400">
            Let the assistant create drafts, upload files or post on your behalf. It always asks before acting.
          </p>
        </div>
        <app-switch [checked]="allowWrite()" [disabled]="saving" (checkedChange)="allowWrite.set($event)"
          ariaLabel="Allow write actions"></app-switch>
      </div>

      <p class="flex items-start gap-2 text-xs leading-relaxed text-gray-400">
        <ion-icon name="shield-checkmark-outline" class="mt-0.5 shrink-0 text-sm"></ion-icon>
        Access is limited to what you authorize in {{ provider.name }}. You can disconnect at any time and the
        assistant loses access immediately.
      </p>

      <div class="flex justify-end gap-2 border-t border-gray-100 pt-4">
        <button type="button" (click)="cancelled.emit()" [disabled]="saving"
          class="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Cancel
        </button>
        <button type="button" (click)="confirmed.emit(allowWrite())" [disabled]="saving"
          class="flex items-center gap-2 rounded-full bg-brand-bold px-4 py-2 text-sm font-semibold text-white hover:bg-brand-ink disabled:opacity-50 transition-colors">
          @if (saving) {
            <ion-icon name="sync-outline" class="animate-spin text-base"></ion-icon>
          }
          {{ connection ? 'Save changes' : 'Continue to ' + provider.name }}
        </button>
      </div>
    </div>
  `,
})
export class AccountConnectFormComponent implements OnInit {
  @Input({ required: true }) provider!: AccountProviderDefinition;
  @Input() connection: AccountConnection | null = null;
  @Input() saving = false;

  @Output() readonly confirmed = new EventEmitter<boolean>();
  @Output() readonly cancelled = new EventEmitter<void>();

  readonly allowWrite = signal(false);

  ngOnInit(): void {
    this.allowWrite.set(this.connection?.allowWrite ?? false);
  }
}
