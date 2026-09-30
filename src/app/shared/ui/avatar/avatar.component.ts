import { Component, Input, OnChanges, SimpleChanges, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { avatarColorFor, initialsOf } from '../../utils/avatar.util';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Tamaño → caja + texto (los pares más usados en las plantillas de features). */
const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

/**
 * Avatar circular: imagen si hay `imageUrl` (y carga bien) o iniciales sobre un color estable.
 *
 * Uso: `<app-avatar [name]="c.displayName" [seed]="c.id" size="sm" />`
 *
 * Inputs:
 * - `name`: de él salen las iniciales (`initialsOf`: primera + última palabra) y el `alt`.
 * - `seed`: semilla del color (id recomendado, estable aunque cambie el nombre). Sin seed → `name`.
 * - `size`: 'xs' h-6 · 'sm' h-8 · 'md' h-10 (default) · 'lg' h-12 · 'xl' h-16.
 * - `sizeClass`: sobreescribe caja+texto para tamaños intermedios (p. ej. el h-9 de muchas filas:
 *   `sizeClass="h-9 w-9 text-xs"`).
 * - `imageUrl`: si falla la carga (`error`), vuelve a las iniciales.
 * - `colorClass`: fuerza el fondo (p. ej. 'bg-brand-bold' para "yo").
 *
 * Normalizado: todas las copias usan `font-bold text-white` y `shrink-0`; algunas usaban
 * `font-semibold` (mail) — se unifica a bold.
 */
@Component({
  selector: 'app-avatar',
  imports: [NgClass],
  host: { class: 'inline-flex shrink-0 align-middle' },
  template: `
    <span class="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white"
      [ngClass]="boxClass" [attr.aria-label]="name || null" role="img">
      @if (imageUrl && !imageFailed()) {
        <img [src]="imageUrl" [alt]="name" class="h-full w-full object-cover" (error)="imageFailed.set(true)" />
      } @else {
        <span aria-hidden="true">{{ initials }}</span>
      }
    </span>
  `,
})
export class AvatarComponent implements OnChanges {
  @Input() name: string | null = '';
  @Input() seed: string | null = null;
  @Input() size: AvatarSize = 'md';
  @Input() sizeClass: string | null = null;
  @Input() imageUrl: string | null = null;
  @Input() colorClass: string | null = null;

  /** La imagen actual no cargó: se muestran las iniciales. */
  readonly imageFailed = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['imageUrl']) {
      this.imageFailed.set(false);
    }
  }

  get initials(): string {
    return initialsOf(this.name);
  }

  get boxClass(): string {
    const size = this.sizeClass || SIZE_CLASSES[this.size] || SIZE_CLASSES.md;
    const showsImage = !!this.imageUrl && !this.imageFailed();
    const color = showsImage ? 'bg-gray-100' : this.colorClass || avatarColorFor(this.seed || this.name || '');
    return `${size} ${color}`;
  }
}
