import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiConfigService } from '@core/config/api-config.service';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';

/** Descriptor no sensible que devuelve GET /storage/public/{token}/meta (link de archivo). */
interface ShareMeta {
  ready: boolean;
  requiresPassword: boolean;
  fileName?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  permission?: string | null;
  expiresAt?: string | null;
}

interface FolderCrumb {
  folderId: string;
  name: string;
}
interface FolderSubfolder {
  folderId: string;
  name: string;
}
interface FolderFile {
  fileId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
}
/** GET /storage/public/{token}/folder (link de carpeta). */
interface FolderContents {
  folderId: string;
  folderName: string;
  isRecursive: boolean;
  permission: string;
  expiresAt: string | null;
  breadcrumb: FolderCrumb[];
  subfolders: FolderSubfolder[];
  files: FolderFile[];
}

type PageState = 'loading' | 'ready' | 'password' | 'unavailable';
type ShareMode = 'file' | 'folder';

/**
 * Página pública de un enlace compartido. El cliente externo llega por
 * `https://<oficina>.taxproffice.com/s/<token>`, SIN sesión (fuera del authGuard).
 *
 * Dos modos: un link de ARCHIVO abre/descarga un solo documento; un link de CARPETA muestra un
 * mini explorador (navegar subcarpetas, descargar archivos sueltos, o "Download all" en .zip).
 * El binario nunca queda en esta página: cada descarga pega al resolver del backend, que responde
 * un 302 a una URL presignada efímera. Cualquier token inválido/expirado/revocado cae a la misma
 * pantalla neutra (anti-enumeración).
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
  /** Contraseña ya validada: se reusa en navegación y descargas del modo carpeta. */
  private unlockedPassword: string | null = null;

  readonly state = signal<PageState>('loading');
  readonly mode = signal<ShareMode>('file');
  readonly meta = signal<ShareMeta | null>(null);
  readonly folder = signal<FolderContents | null>(null);
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
    this.probe();
  }

  /** Primero intenta como carpeta; si no es carpeta (404), cae al descriptor de archivo. */
  private probe(): void {
    let folderUrl: string;
    try {
      folderUrl = this.folderUrl(null);
    } catch {
      this.state.set('unavailable');
      return;
    }
    this.http.get<FolderContents>(folderUrl).subscribe({
      next: contents => {
        this.mode.set('folder');
        this.folder.set(contents);
        this.state.set('ready');
      },
      error: err => {
        if (err?.status === 401) {
          this.mode.set('folder');
          this.state.set('password');
          return;
        }
        this.loadFileMeta();
      },
    });
  }

  private loadFileMeta(): void {
    let url: string;
    try {
      url = this.metaUrl();
    } catch {
      this.state.set('unavailable');
      return;
    }
    this.http.get<ShareMeta>(url).subscribe({
      next: meta => {
        this.mode.set('file');
        this.meta.set(meta);
        this.state.set(meta.requiresPassword ? 'password' : 'ready');
      },
      error: () => this.state.set('unavailable'),
    });
  }

  // ---------- Carpeta ----------

  /** true si el link de carpeta permite descargar (habilita "Download all" y la descarga por archivo). */
  folderAllowsDownload(): boolean {
    return this.folder()?.permission === 'Download';
  }

  navigateFolder(folderId: string): void {
    this.state.set('loading');
    this.http.get<FolderContents>(this.folderUrl(folderId, this.unlockedPassword ?? undefined)).subscribe({
      next: contents => {
        this.folder.set(contents);
        this.state.set('ready');
      },
      error: () => this.state.set('unavailable'),
    });
  }

  downloadFolderFile(fileId: string): void {
    try {
      window.location.href = this.resolverUrl(this.unlockedPassword ?? undefined, fileId);
    } catch {
      this.state.set('unavailable');
    }
  }

  downloadAll(): void {
    const current = this.folder()?.folderId;
    if (!current) {
      return;
    }
    try {
      window.location.href = this.zipUrl(current, this.unlockedPassword ?? undefined);
    } catch {
      this.state.set('unavailable');
    }
  }

  // ---------- Archivo ----------

  isViewOnly(): boolean {
    const p = this.meta()?.permission;
    return p === 'View' || p === 'Preview';
  }

  open(): void {
    try {
      window.location.href = this.resolverUrl();
    } catch {
      this.state.set('unavailable');
    }
  }

  // ---------- Contraseña ----------

  async submitPassword(): Promise<void> {
    const pw = this.password().trim();
    if (!pw || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.passwordError.set(false);

    if (this.mode() === 'folder') {
      await this.submitFolderPassword(pw);
      return;
    }
    await this.submitFilePassword(pw);
  }

  /** Carpeta: reintenta el listado con la contraseña; si abre, la guarda para navegación/descargas. */
  private async submitFolderPassword(pw: string): Promise<void> {
    try {
      const contents = await this.http
        .get<FolderContents>(this.folderUrl(null, pw))
        .toPromise();
      this.unlockedPassword = pw;
      this.folder.set(contents!);
      this.mode.set('folder');
      this.state.set('ready');
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 401) {
        this.passwordError.set(true);
        this.submitting.set(false);
        return;
      }
      this.state.set('unavailable');
    }
  }

  /** Archivo: prueba contra el resolver; 401 = contraseña incorrecta, cualquier otra = redirect válido. */
  private async submitFilePassword(pw: string): Promise<void> {
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
      window.location.href = target;
    }
  }

  // ---------- URLs ----------

  private metaUrl(): string {
    const base = this.api.tenantUrl(`/storage/public/${encodeURIComponent(this.token)}/meta`);
    return this.email ? `${base}?email=${encodeURIComponent(this.email)}` : base;
  }

  private folderUrl(folderId: string | null, pw?: string): string {
    return this.withParams(this.api.tenantUrl(`/storage/public/${encodeURIComponent(this.token)}/folder`), pw, folderId);
  }

  private zipUrl(folderId: string, pw?: string): string {
    return this.withParams(this.api.tenantUrl(`/storage/public/${encodeURIComponent(this.token)}/zip`), pw, folderId);
  }

  private resolverUrl(pw?: string, fileId?: string): string {
    return this.withParams(this.api.tenantUrl(`/storage/public/${encodeURIComponent(this.token)}`), pw, null, fileId);
  }

  private withParams(base: string, pw?: string, folderId?: string | null, fileId?: string): string {
    const params = new URLSearchParams();
    if (pw) {
      params.set('password', pw);
    }
    if (this.email) {
      params.set('email', this.email);
    }
    if (folderId) {
      params.set('folderId', folderId);
    }
    if (fileId) {
      params.set('fileId', fileId);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  // ---------- Formato ----------

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
