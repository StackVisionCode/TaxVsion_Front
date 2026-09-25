import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/** Miembro del staff del tenant, resuelto para pickers y avatares (userId → nombre/iniciales/color). */
export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  actorType: string;
  initials: string;
  avatarColor: string;
}

interface AuthUserRow {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  isActive: boolean;
}

const AVATAR_PALETTE = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];

/**
 * Directorio de staff del tenant (GET /auth/users), cacheado en memoria. Resuelve userId → nombre/avatar
 * para los asignados del directorio y del diálogo, y alimenta el picker "asignar a quién" (filtro
 * client-side). Solo staff activo (excluye CustomerPortal). Es una feature admin-only, así que /auth/users
 * está disponible; si fallara, queda vacío (el picker no muestra a nadie, sin romper la página).
 */
@Injectable({ providedIn: 'root' })
export class StaffDirectoryStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private readonly _members = signal<StaffMember[]>([]);
  private loaded = false;

  readonly members: Signal<StaffMember[]> = computed(() => this._members());

  /** Carga el staff una sola vez. Idempotente. */
  ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.fetch().subscribe();
  }

  /** Fuerza recarga (p.ej. tras alta/baja de un usuario). */
  reload(): void {
    this.fetch().subscribe();
  }

  resolve(userId: string): StaffMember | undefined {
    return this._members().find(m => m.userId === userId);
  }

  /** Filtro client-side por nombre/email para el picker. */
  search(term: string): StaffMember[] {
    const q = term.trim().toLowerCase();
    const all = this._members();
    return q ? all.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : all;
  }

  private fetch(): Observable<StaffMember[]> {
    const params = new HttpParams().set('size', '100').set('isActive', 'true');
    return this.http.get<{ items: AuthUserRow[] }>(this.api.tenantUrl('/auth/users'), { params }).pipe(
      map(res =>
        (res.items ?? [])
          .filter(u => u.isActive && u.actorType !== 'CustomerPortal')
          .map(toStaffMember)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
      tap(members => this._members.set(members)),
      catchError(() => of([] as StaffMember[])),
    );
  }
}

function toStaffMember(u: AuthUserRow): StaffMember {
  const name = `${u.name ?? ''} ${u.lastName ?? ''}`.trim() || u.email;
  return {
    userId: u.id,
    name,
    email: u.email,
    actorType: u.actorType,
    initials: deriveInitials(name),
    avatarColor: pickAvatarColor(u.id),
  };
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2
    ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
    : name.substring(0, 2).toUpperCase();
}

function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
