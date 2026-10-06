import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiConfigService } from '@core/config/api-config.service';
import { BrandLogoComponent } from '@core/theme/brand-logo.component';
import { formatBytes } from '@shared/utils/format.util';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';

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
 * mini explorador (navegar subcarpetas, ver o descargar archivos sueltos, o "Download all" en .zip).
 * "View" abre el visor global de archivos (`app-file-viewer`) dentro de la página: los bytes se
 * bajan del mismo resolver (302 → presignada). En links de solo lectura el visor no ofrece descarga.
 * El binario nunca queda en esta página: cada descarga pega al resolver del backend, que responde
 * un 302 a una URL presignada efímera. Cualquier token inválido/expirado/revocado cae a la misma
 * pantalla neutra (anti-enumeración).
 */
@Component({
  selector: 'app-public-share-page',
  standalone: true,
  imports: [FormsModule, BrandLogoComponent, FileViewerComponent],
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

  /** Visor global: el archivo del link, o los archivos de la carpeta actual. */
  readonly viewerOpen = signal(false);
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

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

  /** Abre el visor con los archivos de la carpeta actual, empezando por `fileId`. */
  viewFolderFile(fileId: string): void {
    const files = this.folder()?.files ?? [];
    const start = files.findIndex(f => f.fileId === fileId);
    if (start < 0) {
      return;
    }
    const pw = this.unlockedPassword ?? undefined;
    this.viewerFiles.set(
      files.map(f => ({
        name: f.name,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        resolveUrl: () => this.lazyUrl(() => this.resolverUrl(pw, f.fileId)),
        ref: f.fileId,
      })),
    );
    this.viewerIndex.set(start);
    this.viewerOpen.set(true);
  }

  /** Descarga pedida desde el visor (solo existe si el link lo permite). */
  onViewerDownload(ref: unknown): void {
    if (this.mode() === 'folder' && typeof ref === 'string') {
      this.downloadFolderFile(ref);
    } else {
      this.open();
    }
  }

  /** ¿El visor ofrece descarga? Lo decide el permiso del link (carpeta o archivo). */
  viewerAllowsDownload(): boolean {
    return this.mode() === 'folder' ? this.folderAllowsDownload() : !this.isViewOnly();
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

  /** Descarga del archivo del link (el resolver responde 302 a la presignada). */
  open(): void {
    try {
      window.location.href = this.resolverUrl(this.unlockedPassword ?? undefined);
    } catch {
      this.state.set('unavailable');
    }
  }

  /** Abre el archivo del link en el visor global. */
  viewFile(): void {
    const meta = this.meta();
    const pw = this.unlockedPassword ?? undefined;
    this.viewerFiles.set([
      {
        name: meta?.fileName || 'Shared document',
        contentType: meta?.contentType ?? null,
        sizeBytes: meta?.sizeBytes ?? null,
        resolveUrl: () => this.lazyUrl(() => this.resolverUrl(pw)),
      },
    ]);
    this.viewerIndex.set(0);
    this.viewerOpen.set(true);
  }

  /** La URL se arma al mostrar el archivo; si falla (sin API configurada) el visor muestra su error. */
  private lazyUrl(build: () => string): Promise<string> {
    try {
      return Promise.resolve(build());
    } catch (err) {
      return Promise.reject(err);
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
    } catch {
      // Sin respuesta legible (red/CORS): se sigue igual; si la contraseña no vale, el visor lo dirá.
    }
    // Desbloqueado: la tarjeta del archivo queda lista y se abre el visor directamente.
    this.unlockedPassword = pw;
    this.submitting.set(false);
    this.state.set('ready');
    this.viewFile();
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
    return bytes == null ? '' : formatBytes(bytes, { maxUnit: 'GB' });
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
