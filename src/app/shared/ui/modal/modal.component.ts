import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

/** Ancho máximo del panel por tamaño (Tailwind). */
const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-6xl',
};

/**
 * Shell de modal reusable (estilo "Aether"): backdrop oscuro que cierra al
 * click, panel blanco centrado `rounded-[28px]` con scroll interno, header
 * con título/subtítulo + botón X, y un único `<ng-content>` para el cuerpo
 * (los botones de pie viajan como parte del contenido, todo scrollea junto).
 * Cierra también con Escape. Es el esqueleto común extraído de los 9
 * form-panels de las features; los inputs se llaman `heading`/`subheading`
 * (no `title`) para no disparar el tooltip nativo del navegador en el host.
 */
@Component({
  selector: 'app-modal',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.css',
})
export class ModalComponent {
  @Input() isOpen = false;
  @Input() heading = '';
  @Input() subheading = '';
  @Input() size: ModalSize = 'lg';
  @Output() closed = new EventEmitter<void>();

  get sizeClass(): string {
    return SIZE_CLASSES[this.size];
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) {
      this.closed.emit();
    }
  }

  close(): void {
    this.closed.emit();
  }
}
