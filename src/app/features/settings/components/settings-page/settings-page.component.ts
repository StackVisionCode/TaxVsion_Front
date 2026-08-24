import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsModuleGridComponent, SETTINGS_MODULES } from '../../ui/settings-module-grid/settings-module-grid.component';
import { SettingsPanelComponent } from '../../ui/settings-panel/settings-panel.component';

/**
 * Página del módulo Settings (estilo "Aether"): grilla de módulos arriba +
 * panel de detalle abajo. Reemplaza el shell de 11 sub-módulos del CRM
 * original con una vista maestro-detalle en una sola página.
 *
 * El módulo no tiene `data-access/` porque hoy no persiste nada contra el
 * backend: lo único con efecto real son los colores del tema (ThemeService,
 * en Overview). Los módulos cuyos datos SÍ tienen backend navegan a su propia
 * pantalla (Company → /company/settings, Storage, Templates); el resto se
 * muestra deshabilitado — ver el detalle en settings-panel.component.ts.
 */
@Component({
  selector: 'app-settings-page',
  imports: [CommonModule, SettingsModuleGridComponent, SettingsPanelComponent],
  templateUrl: './settings-page.component.html',
})
export class SettingsPageComponent {
  readonly selectedModuleId = signal('overview');

  readonly selectedModuleTitle = computed(
    () => SETTINGS_MODULES.find(m => m.id === this.selectedModuleId())?.title ?? 'Overview',
  );

  selectModule(id: string): void {
    this.selectedModuleId.set(id);
  }
}
