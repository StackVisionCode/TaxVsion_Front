import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ThemeService } from '@core/theme/theme.service';
import { PublicSharingSettingComponent } from '../public-sharing-setting/public-sharing-setting.component';

/**
 * Un campo con persistencia real. Hoy el único caso son los colores del tema,
 * que ThemeService aplica al instante y recuerda en este navegador.
 */
interface ColorField {
  kind: 'color';
  key: 'primaryColor' | 'secondaryColor';
  label: string;
  description: string;
}

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

type SettingField = ColorField | PendingField;

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
 * De todo lo que había, lo único con persistencia real son los colores del tema
 * (ThemeService → variables CSS + localStorage). Los datos de identidad de la
 * firma (nombre, EIN, dirección, logo, paleta del tenant) sí tienen backend,
 * pero viven en /company/settings (Billing `/billing/issuer-profile` y
 * `/tenants/{id}/...`), así que aquí se enlaza esa pantalla en vez de duplicar
 * un formulario que no guardaría nada.
 */
const PANELS: Record<string, PanelConfig> = {
  overview: {
    link: {
      icon: 'business-outline',
      label: 'Open company settings',
      description:
        'Firm name, EIN, address, contact details, logo and tenant brand colors are stored with your company profile.',
      routerLink: '/company/settings',
    },
    fields: [
      // Los colores de marca se configuran a nivel de tenant en /company/settings (permiso
      // branding.manage), no por navegador. El picker localStorage viejo se retiró para no tener
      // dos fuentes de verdad en conflicto — ver TenantBrands.
      { kind: 'pending', key: 'timezone', control: 'select', label: 'Default timezone', description: 'Will set the timezone used for due dates and reminders' },
      { kind: 'pending', key: 'compactSidebar', control: 'toggle', label: 'Compact sidebar by default', description: 'Will start every session with the sidebar collapsed' },
    ],
  },
  accounts: {
    fields: [
      { kind: 'pending', key: 'requireSsn', control: 'toggle', label: 'Require SSN/ITIN on intake', description: 'Will block saving a new client without this field' },
      { kind: 'pending', key: 'defaultType', control: 'select', label: 'Default client type', description: 'Will be pre-selected when adding a new client' },
    ],
  },
  documents: {
    fields: [
      { kind: 'pending', key: 'autoOcr', control: 'toggle', label: 'Auto-scan uploaded PDFs', description: 'Will extract text for search automatically' },
      { kind: 'pending', key: 'retention', control: 'select', label: 'Retention policy', description: 'Will define how long deleted files stay in the recycle bin' },
    ],
  },
  invoices: {
    fields: [
      { kind: 'pending', key: 'currency', control: 'select', label: 'Default currency', description: 'Will be applied to new invoices' },
      { kind: 'pending', key: 'autoReminders', control: 'toggle', label: 'Auto-reminders for unpaid invoices', description: 'Will send a reminder after the due date' },
    ],
  },
  mail: {
    fields: [
      { kind: 'pending', key: 'emailNotifs', control: 'toggle', label: 'Email notifications', description: 'Will control emails about client replies and uploads' },
      { kind: 'pending', key: 'signature', control: 'toggle', label: 'Signature on outgoing mail', description: "Will append your firm's signature block" },
      { kind: 'pending', key: 'replyTo', control: 'text', label: 'Default reply-to', description: 'Will be used when clients respond to notifications' },
    ],
  },
  signature: {
    fields: [
      { kind: 'pending', key: 'reminders', control: 'toggle', label: 'Auto-remind unsigned documents', description: 'Will send a nudge when a document stays unsigned' },
      { kind: 'pending', key: 'expiry', control: 'select', label: 'Link expiration', description: 'Will define how long a signing link stays valid' },
    ],
  },
  meetings: {
    fields: [
      { kind: 'pending', key: 'waitingRoom', control: 'toggle', label: 'Enable waiting room', description: 'Will hold clients until you admit them' },
      { kind: 'pending', key: 'recordByDefault', control: 'toggle', label: 'Record meetings by default', description: 'Will start recording as soon as a meeting begins' },
    ],
  },
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
 * Los colores no lo necesitan (se aplican al instante) y el resto de campos no
 * tiene dónde guardarse todavía.
 */
@Component({
  selector: 'app-settings-panel',
  imports: [CommonModule, FormsModule, RouterLink, PublicSharingSettingComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './settings-panel.component.html',
})
export class SettingsPanelComponent implements OnChanges {
  private readonly theme = inject(ThemeService);

  @Input() moduleId = 'overview';
  @Input() moduleTitle = 'Overview';

  readonly fields = signal<SettingField[]>(PANELS['overview'].fields);
  readonly link = signal<PanelLink | null>(PANELS['overview'].link ?? null);
  readonly note = signal<string | null>(PANELS['overview'].note ?? null);
  readonly colorPresets = this.theme.presets;

  /** true si en este módulo no hay un solo campo que llegue al backend. */
  readonly allPending = computed(() => this.fields().every(field => field.kind === 'pending'));

  /** true si hay al menos un campo sin respaldo (para mostrar el aviso). */
  readonly hasPending = computed(() => this.fields().some(field => field.kind === 'pending'));

  /**
   * En los paneles mixtos (hoy solo Overview) cada campo sin respaldo lleva su
   * propia marca, para que no se confunda con los que sí se aplican de verdad.
   */
  readonly showPendingBadge = computed(() => this.hasPending() && !this.allPending());

  ngOnChanges(): void {
    // Los módulos que navegan a su propia pantalla (ej. Company) no tienen panel local.
    const panel: PanelConfig = PANELS[this.moduleId] ?? { fields: [] };
    this.fields.set(panel.fields);
    this.link.set(panel.link ?? null);
    this.note.set(panel.note ?? null);
  }

  /** El color se aplica al instante: no hay nada que "guardar" después. */
  updateColor(key: ColorField['key'], hex: string): void {
    if (key === 'secondaryColor') {
      this.theme.setSecondaryColor(hex);
    } else {
      this.theme.setPrimaryColor(hex);
    }
  }

  colorFor(key: ColorField['key']): string {
    return key === 'secondaryColor' ? this.theme.secondaryColor() : this.theme.primaryColor();
  }
}
