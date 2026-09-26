import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/** Miembro del staff del tenant, resuelto para pickers y avatares (userId → nombre/iniciales/color). */
export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  actorType: string;
  initials: string;
  avatarColor: string;
  /** Puede trabajar hoy. Un suspendido conserva sus asignaciones; un retirado ya no tiene ninguna. */
  isActive: boolean;
  /** Active | Deactivated | Offboarded (espejo de Auth). */
  status: string;
}

interface AuthUserRow {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  isActive: boolean;
  status?: string;
}

interface AuthUserPage {
  items: AuthUserRow[];
  totalPages: number;
}

const AVATAR_PALETTE = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];
const PAGE_SIZE = 100;

/**
 * Directorio de staff del tenant (GET /auth/users), cacheado en memoria. Resuelve userId → nombre/avatar
 * para los asignados y alimenta el picker "asignar a quién". Trae el staff COMPLETO, activo y suspendido:
 * suspender es reversible y el suspendido conserva sus clientes, así que sin él la tarjeta de asignados
 * mostraba "Unknown user". Para elegir a quién asignar se usa `assignable` (solo quien puede trabajar hoy).
 * Es una pantalla admin-only, así que /auth/users está disponible; si fallara queda vacío sin romper nada.
 */
@Injectable({ providedIn: 'root' })
export class StaffDirectoryStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private readonly _members = signal<StaffMember[]>([]);
  private loaded = false;

  /** Todo el staff, para poner nombre a cualquier asignación existente. */
  readonly members: Signal<StaffMember[]> = computed(() => this._members());

  /** A quién se le puede asignar un cliente hoy. */
  readonly assignable: Signal<StaffMember[]> = computed(() => this._members().filter(m => m.isActive));

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

  /** Filtro client-side por nombre/email para el picker: solo asignables. */
  search(term: string): StaffMember[] {
    const q = term.trim().toLowerCase();
    const all = this.assignable();
    return q ? all.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : all;
  }

  private fetch(): Observable<StaffMember[]> {
    return this.page(1).pipe(
      switchMap(first => {
        const rest = [];
        for (let page = 2; page <= (first.totalPages ?? 1); page++) {
          rest.push(this.page(page));
        }
        return rest.length === 0 ? of([first]) : forkJoin([of(first), ...rest]);
      }),
      map(pages =>
        pages
          .flatMap(p => p.items ?? [])
          .map(toStaffMember)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
      tap(members => this._members.set(members)),
      catchError(() => of([] as StaffMember[])),
    );
  }

  private page(page: number): Observable<AuthUserPage> {
    const params = new HttpParams().set('accountKind', 'Staff').set('page', page).set('size', PAGE_SIZE);
    return this.http.get<AuthUserPage>(this.api.tenantUrl('/auth/users'), { params });
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
    isActive: u.isActive,
    status: u.status ?? (u.isActive ? 'Active' : 'Deactivated'),
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
