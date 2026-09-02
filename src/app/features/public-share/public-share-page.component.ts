import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiConfigService } from '@core/config/api-config.service';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

/** Descriptor no sensible que devuelve GET /storage/public/{token}/meta. */
interface ShareMeta {
  ready: boolean;
  requiresPassword: boolean;
  fileName?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  permission?: string | null;
  expiresAt?: string | null;
}

type PageState = 'loading' | 'ready' | 'password' | 'unavailable';

/**
 * Página pública de un enlace compartido. El cliente externo llega por
 * `https://<oficina>.taxproffice.com/s/<token>`, SIN sesión (fuera del authGuard).
 *
 * La marca la aplica <app-brand-logo> por el subdominio de la oficina (con cascada a la del
 * sistema). El archivo lo describe el backend por el token; el nombre NUNCA se revela si el
 * enlace tiene contraseña. El archivo real solo se pide al pulsar el botón, contra el resolver
 * (`/storage/public/<token>`), que responde con la URL presignada de 2 minutos — nunca queda
 * en esta página. Cualquier token inválido/expirado/revocado cae a la misma pantalla neutra.
 */
@Component({
  selector: 'app-public-share-page',
  standalone: true,
  imports: [FormsModule, BrandLogoComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './public-share-page.component.html',
  styleUrl: './public-share-page.component.css',
})
export class PublicSharePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiConfigService);
  private readonly http = inject(HttpClient);

  private token = '';
  private email: string | null = null;

  readonly state = signal<PageState>('loading');
  readonly meta = signal<ShareMeta | null>(null);
  readonly password = signal('');
  readonly passwordError = signal(false);
  readonly submitting = signal(false);

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.email = this.route.snapshot.queryParamMap.get('email');
    if (!this.token) {
      this.state.set('unavailable');
      return;
    }

    let url: string;
    try {
      url = this.metaUrl();
    } catch {
      this.state.set('unavailable');
      return;
    }

    this.http.get<ShareMeta>(url).subscribe({
      next: meta => {
        this.meta.set(meta);
        this.state.set(meta.requiresPassword ? 'password' : 'ready');
      },
      // Token inválido/expirado/revocado (404) o red: misma pantalla neutra, sin filtrar por qué.
      error: () => this.state.set('unavailable'),
    });
  }

  /** true si el enlace es de solo ver (se abre en el navegador en vez de forzar descarga). */
  isViewOnly(): boolean {
    const p = this.meta()?.permission;
    return p === 'View' || p === 'Preview';
  }

  /** Enlace SIN contraseña: navega al resolver, que hace 302 a la URL presignada. */
  open(): void {
    try {
      window.location.href = this.resolverUrl();
    } catch {
      this.state.set('unavailable');
    }
  }

  /**
   * Enlace CON contraseña: prueba primero contra el resolver (mismo origen en prod). Un 401
   * significa contraseña incorrecta y se mantiene en la pantalla; cualquier otra respuesta es un
   * redirect válido y se navega de verdad para disparar la descarga.
   */
  async submitPassword(): Promise<void> {
    const pw = this.password().trim();
    if (!pw || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.passwordError.set(false);

    let target: string;
    try {
      target = this.resolverUrl(pw);
    } catch {
      this.state.set('unavailable');
      return;
    }

    try {
      const res = await fetch(target, { redirect: 'manual' });
      if (res.status === 401) {
        this.passwordError.set(true);
        this.submitting.set(false);
        return;
      }
      window.location.href = target;
    } catch {
      // Sin poder confirmar (p. ej. red): intenta la navegación directa igualmente.
      window.location.href = target;
    }
  }

  private metaUrl(): string {
    const base = this.api.tenantUrl(`/storage/public/${encodeURIComponent(this.token)}/meta`);
    return this.email ? `${base}?email=${encodeURIComponent(this.email)}` : base;
  }

  private resolverUrl(pw?: string): string {
    const base = this.api.tenantUrl(`/storage/public/${encodeURIComponent(this.token)}`);
    const params = new URLSearchParams();
    if (pw) {
      params.set('password', pw);
    }
    if (this.email) {
      params.set('email', this.email);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  formatSize(bytes?: number | null): string {
    if (bytes == null) {
      return '';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  formatExpiry(iso?: string | null): string {
    if (!iso) {
      return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
    if (days <= 0) {
      return 'Expires today';
    }
    if (days === 1) {
      return 'Expires tomorrow';
    }
    if (days <= 30) {
      return `Expires in ${days} days`;
    }
    return `Available until ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
  }

  /** Icono según el tipo, sin exponer el tipo crudo. */
  fileIcon(contentType?: string | null): string {
    const t = (contentType ?? '').toLowerCase();
    if (t.includes('pdf')) {
      return 'document-text';
    }
    if (t.startsWith('image/')) {
      return 'image';
    }
    if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) {
      return 'grid';
    }
    if (t.includes('word') || t.includes('document')) {
      return 'document';
    }
    return 'document-outline';
  }
}
