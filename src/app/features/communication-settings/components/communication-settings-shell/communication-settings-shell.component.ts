import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { COMMUNICATION_SETTINGS_PAGES } from '../../communication-settings-pages';

/**
 * F9 — Settings → Communication: encabezado, pestañas a las páginas que el usuario puede abrir y la barra de
 * guardar. El borrador es uno solo para toda la sección (store de la ruta padre), así que pasar de "Chat" a
 * "Meetings" no pierde lo editado y "Save" guarda todo junto.
 */
@Component({
  selector: 'app-communication-settings-shell',
  imports: [RouterLink, RouterOutlet, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="min-h-full pt-3 pb-24 flex flex-col gap-4">
      <div class="lg:pr-[var(--shell-notch-width)]">
        <a routerLink="/settings" class="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors">
          <ion-icon name="arrow-back-outline" class="text-sm"></ion-icon>
          Settings
        </a>
        <h1 class="mt-1 text-2xl font-bold text-gray-900">Communication</h1>
        <p class="mt-1 text-sm text-gray-500">How your office uses chat, meetings, calls and recording. Values can't go above your plan's limits.</p>
        <nav class="mt-4 flex flex-wrap gap-2" aria-label="Communication settings">
          @for (page of pages(); track page.path) {
            <!-- Sin RouterLinkActive: solo se usaría aquí y sumaría su código al chunk inicial del router. -->
            <a [routerLink]="page.path" [attr.aria-current]="isActive(page.path) ? 'page' : null"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors"
              [class]="isActive(page.path) ? 'border-brand-bold bg-brand-bold text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'">
              <ion-icon [name]="page.icon" class="text-sm"></ion-icon>{{ page.title }}
            </a>
          }
        </nav>
      </div>

      @if (store.changedElsewhere()) {
        <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status" data-role="changed-elsewhere">
          <ion-icon name="information-circle-outline" class="text-base"></ion-icon>
          Someone else just changed these settings. Your unsaved changes are still here.
          <button type="button" class="font-semibold underline" (click)="store.reload()">Load their changes</button>
        </div>
      }

      @if (store.overview()) {
        <router-outlet></router-outlet>
      } @else {
        <app-state-block [loading]="store.loading()" [error]="store.loadError()" (retry)="store.reload()"></app-state-block>
      }
    </div>

    @if (store.dirty() || store.saveError()) {
      <div class="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:px-6" data-role="save-bar">
        <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-3">
          @if (store.saveError(); as error) {
            <p class="mr-auto flex items-center gap-1.5 text-sm font-medium text-red-600" role="alert">
              <ion-icon name="alert-circle-outline" class="text-base"></ion-icon>{{ error }}
            </p>
          } @else {
            <p class="mr-auto text-sm text-gray-500">You have unsaved changes.</p>
          }
          <button type="button" (click)="store.discard()" [disabled]="store.saving()"
            class="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Discard</button>
          <button type="button" (click)="save()" [disabled]="store.saving() || !store.dirty()" data-role="save-settings"
            class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white hover:bg-brand-ink disabled:opacity-50">
            {{ store.saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class CommunicationSettingsShellComponent {
  protected readonly store = inject(CommunicationSettingsStore);
  private readonly access = inject(AccessStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly pages = computed(() => COMMUNICATION_SETTINGS_PAGES.filter(page => this.access.canUseId(page.featureId)));

  constructor() {
    this.store.ensureLoaded();
  }

  isActive(path: string): boolean {
    return this.router.url.split(/[?#]/)[0]?.endsWith(`/communication/${path}`) ?? false;
  }

  async save(): Promise<void> {
    if (await this.store.save()) this.toast.success('Communication settings saved.');
  }
}
