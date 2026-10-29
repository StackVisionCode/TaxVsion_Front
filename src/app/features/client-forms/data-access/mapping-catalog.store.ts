import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { MappingCatalog } from './mapping-catalog.model';
import { MappingCatalogService } from './mapping-catalog.service';

/**
 * Estado del catálogo de destinos para el builder. Se pide una vez por pantalla: solo cambia con
 * un deploy. Sin copias locales: si falla, la UI muestra el error y ofrece reintentar.
 */
@Injectable()
export class MappingCatalogStore {
  private readonly service = inject(MappingCatalogService);
  private pending: Promise<void> | null = null;

  readonly catalog = signal<MappingCatalog | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  /** Idempotente: no repite la llamada si ya hay catálogo o una en curso. */
  load(): Promise<void> {
    if (this.catalog()) return Promise.resolve();
    return (this.pending ??= this.fetch());
  }

  reload(): Promise<void> {
    this.catalog.set(null);
    return this.load();
  }

  private async fetch(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.catalog.set(await firstValueFrom(this.service.get()));
    } catch {
      this.error.set('The client data catalog could not be loaded.');
    } finally {
      this.loading.set(false);
      this.pending = null;
    }
  }
}
