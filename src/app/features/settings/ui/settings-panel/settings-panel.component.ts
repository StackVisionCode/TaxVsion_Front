import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PublicSharingSettingComponent } from '../public-sharing-setting/public-sharing-setting.component';
import { SharingPolicySettingComponent } from '../sharing-policy-setting/sharing-policy-setting.component';
import { PortalUploadsSettingComponent } from '../portal-uploads-setting/portal-uploads-setting.component';

/**
 * Campo SIN respaldo: no existe endpoint donde guardarlo, así que se dibuja
 * deshabilitado y vacío. `control` solo define qué forma tiene el hueco
 * (interruptor, desplegable o texto) para que la pantalla siga leyéndose como
 * lo que será, sin fingir un valor guardado.
 */
interface PendingField {
  kind: 'pending';
  key: string;
  label: string;
  description: string;
  control: 'toggle' | 'select' | 'text';
}

type SettingField = PendingField;

/** Enlace a una pantalla que SÍ persiste esos datos contra el backend. */
interface PanelLink {
  icon: string;
  label: string;
  description: string;
  routerLink: string;
}

interface PanelConfig {
  fields: SettingField[];
  link?: PanelLink;
  /** Aclaración extra para el módulo (se muestra bajo el aviso general). */
  note?: string;
}

/**
 * Configuración por módulo.
 *
 * NO HAY VALORES SEMBRADOS: la versión anterior mostraba datos inventados
 * ('Reyes Tax & Accounting', 'Eastern Time (ET)', 'support@taxprooffice.com',
 * 'USD ($)'...) que parecían la configuración guardada de la firma. No lo eran:
 * el módulo Settings nunca tuvo `data-access/`, ningún campo llegaba a un
 * endpoint y el botón "Save changes" solo encendía un chip "Saved" durante 2s.
 *
 * Ningún campo de este panel persiste nada: los datos de identidad de la firma
 * (nombre, zona horaria, EIN, dirección, logo) sí tienen backend, pero viven en
 * /company/settings (Tenant `/tenants/current`, `/tenants/current/profile` y `/tenants/{id}/...`),
 * así que aquí se enlaza esa pantalla en vez de duplicar un formulario que no
 * guardaría nada. Los colores de marca son fijos (azul del brandbook) y ya no
 * se editan desde ningún lado.
 */
const PANELS: Record<string, PanelConfig> = {
  // Documents solo muestra ajustes con backend (enlaces públicos, reglas de compartir, subidas del
  // cliente). Los días de la papelera son de plataforma (PlatformAdmin), no de la oficina.
  documents: {
    fields: [],
  },
  invoices: {
    fields: [
      { kind: 'pending', key: 'currency', control: 'select', label: 'Default currency', description: 'Will be applied to new invoices' },
      { kind: 'pending', key: 'autoReminders', control: 'toggle', label: 'Auto-reminders for unpaid invoices', description: 'Will send a reminder after the due date' },
    ],
  },
  // 'mail' abre el panel de buzones de Mail (la firma y el reply-to no tenían backend).
  // 'signature' se movió a su propia página ruteada (/settings/signature); el card del grid navega
  // en vez de abrir un panel inline, así que ya no hay placeholder acá.
  // 'meetings' pasó a Settings → Communication (F9): el card navega a su página, sin placeholder.
  ai: {
    note: 'The AI assistant itself is not available yet, so there is no behavior to configure.',
    fields: [
      { kind: 'pending', key: 'tone', control: 'select', label: 'Suggestion tone', description: 'Will define how the assistant phrases its answers' },
      { kind: 'pending', key: 'proactive', control: 'toggle', label: 'Proactive risk alerts', description: 'Will let the assistant flag anomalies without being asked' },
    ],
  },
};

/**
 * Panel de detalle de un módulo de Settings (estilo "Aether").
 *
 * Se eliminaron el botón "Save changes" y el chip "Saved": no escribían en
 * ningún sitio y hacían creer al usuario que su configuración quedaba guardada.
 * Ningún campo de este panel tiene dónde guardarse todavía.
 */
@Component({
  selector: 'app-settings-panel',
  imports: [SwitchComponent, CommonModule, FormsModule, RouterLink, PublicSharingSettingComponent, SharingPolicySettingComponent, PortalUploadsSettingComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './settings-panel.component.html',
})
export class SettingsPanelComponent implements OnChanges {
  @Input() moduleId = '';
  @Input() moduleTitle = '';

  readonly fields = signal<SettingField[]>([]);
  readonly link = signal<PanelLink | null>(null);
  readonly note = signal<string | null>(null);

  /** true si en este módulo no hay un solo campo que llegue al backend. */
  readonly allPending = computed(
    () => this.fields().length > 0 && this.fields().every(field => field.kind === 'pending'),
  );

  /** true si hay al menos un campo sin respaldo (para mostrar el aviso). */
  readonly hasPending = computed(() => this.fields().some(field => field.kind === 'pending'));

  /**
   * En los paneles mixtos cada campo sin respaldo lleva su propia marca, para que no se
   * confunda con los que sí se aplican de verdad.
   */
  readonly showPendingBadge = computed(() => this.hasPending() && !this.allPending());

  ngOnChanges(): void {
    // Los módulos que navegan a su propia pantalla (ej. Company) no tienen panel local.
    const panel: PanelConfig = PANELS[this.moduleId] ?? { fields: [] };
    this.fields.set(panel.fields);
    this.link.set(panel.link ?? null);
    this.note.set(panel.note ?? null);
  }
}
