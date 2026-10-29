import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import type {
  FormComponent,
  FormDefinition,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import type { BuilderSelection } from '../../data-access/form-template-builder.store';
import type { ClientPoint } from '@shared/utils/palette-drag.util';
import {
  richTextPlainText,
  type RichTextDocument,
} from '@shared/utils/data-collection/rich-text';
import { componentTypeIcon, componentTypeLabel } from '../../utils/component-catalog';

export interface BuilderDropTarget {
  sectionId: string;
  index: number;
}

@Component({
  selector: 'app-builder-canvas',
  imports: [DragDropModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      data-builder-canvas-scroll
      class="h-full overflow-y-auto bg-gray-50 px-6 py-6"
      aria-label="Form canvas"
    >
      <div class="mx-auto max-w-4xl space-y-5">
        @for (page of definition.pages; track page.id; let pageIndex = $index) {
          <article class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <header class="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <button
                type="button"
                class="text-left"
                (click)="selected.emit({ kind: 'page', id: page.id })"
              >
                <span class="text-xs font-semibold uppercase text-brand-bold"
                  >Page {{ pageIndex + 1 }}</span
                >
                <h2 class="mt-0.5 text-lg font-bold text-gray-900">
                  {{ page.title || 'Untitled page' }}
                </h2>
              </button>
              <button
                type="button"
                class="rounded-full px-3 py-2 text-xs font-semibold text-brand-bold hover:bg-brand-surface disabled:opacity-40"
                [disabled]="disabled"
                (click)="sectionAdded.emit(page.id)"
              >
                + Section
              </button>
            </header>
            <div class="space-y-4 p-5">
              @for (section of page.sections; track section.id; let sectionIndex = $index) {
                <section
                  class="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-3"
                  [attr.data-builder-section]="section.id"
                  [class.ring-2]="selection?.id === section.id"
                  [class.ring-brand-light]="selection?.id === section.id"
                >
                  <button
                    type="button"
                    class="mb-3 flex w-full items-center justify-between text-left"
                    (click)="selected.emit({ kind: 'section', id: section.id })"
                  >
                    <span class="text-xs font-bold text-gray-600">{{
                      section.title || 'Section ' + (sectionIndex + 1)
                    }}</span>
                    @if (section.repeat) {
                      <span
                        class="rounded-full bg-sand-100 px-2 py-1 text-[11px] font-semibold text-sand-700"
                        >Repeater</span
                      >
                    }
                  </button>
                  <div
                    cdkDropList
                    [cdkDropListData]="section.components"
                    [id]="section.id"
                    [cdkDropListConnectedTo]="sectionIds"
                    [cdkDropListDisabled]="disabled"
                    class="min-h-16 space-y-2"
                    (cdkDropListDropped)="drop($event, section)"
                  >
                    @for (component of section.components; track component.id; let index = $index) {
                      <div
                        cdkDrag
                        [cdkDragData]="component"
                        [cdkDragDisabled]="disabled"
                        [attr.data-builder-component]="component.id"
                        class="group relative flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm"
                        [class.border-brand-light]="selection?.id === component.id"
                        [class.border-gray-200]="selection?.id !== component.id"
                      >
                        <button
                          cdkDragHandle
                          type="button"
                          class="cursor-move text-gray-400 disabled:cursor-default"
                          aria-label="Drag component"
                          [disabled]="disabled"
                        >
                          <ion-icon name="reorder-two-outline"></ion-icon>
                        </button>
                        <!-- Título (label o vista previa del contenido) + chip del tipo, sin repetir lo mismo. -->
                        <button
                          type="button"
                          class="flex min-w-0 flex-1 items-center gap-2 text-left"
                          (click)="selected.emit({ kind: 'component', id: component.id })"
                        >
                          <ion-icon
                            [name]="icon(component.type)"
                            class="shrink-0 text-base text-brand-bold"
                            aria-hidden="true"
                          ></ion-icon>
                          <span class="min-w-0 flex-1">
                            @if (title(component); as text) {
                              <span class="block truncate text-sm font-semibold text-gray-900"
                                >{{ text
                                }}@if (component.required) {
                                  <span class="text-red-600" aria-label="required"> *</span>
                                }</span
                              >
                            } @else {
                              <span class="block truncate text-sm font-semibold text-gray-900">{{
                                label(component.type)
                              }}</span>
                            }
                          </span>
                          @if (title(component)) {
                            <span
                              class="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600"
                              >{{ label(component.type) }}</span
                            >
                          }
                        </button>
                        <!-- Acciones superpuestas: no ocupan ancho, así el título no se recorta. -->
                        <div
                          class="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full bg-white/95 pl-2 opacity-0 shadow-sm transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                        >
                          <button
                            type="button"
                            class="h-8 w-8 rounded-full text-gray-500 disabled:opacity-30"
                            aria-label="Move up"
                            [disabled]="disabled || index === 0"
                            (click)="
                              move.emit({
                                id: component.id,
                                sectionId: section.id,
                                index: index - 1,
                              })
                            "
                          >
                            <ion-icon name="arrow-up-outline"></ion-icon>
                          </button>
                          <button
                            type="button"
                            class="h-8 w-8 rounded-full text-gray-500 disabled:opacity-30"
                            aria-label="Move down"
                            [disabled]="disabled || index === section.components.length - 1"
                            (click)="
                              move.emit({
                                id: component.id,
                                sectionId: section.id,
                                index: index + 1,
                              })
                            "
                          >
                            <ion-icon name="arrow-down-outline"></ion-icon>
                          </button>
                          @if (sectionIds.length > 1) {
                            <select
                              class="max-w-32 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600"
                              aria-label="Move to section"
                              [disabled]="disabled"
                              (change)="moveToSection($event, component.id)"
                            >
                              <option value="">Move to section...</option>
                              @for (targetId of sectionIds; track targetId) {
                                @if (targetId !== section.id) {
                                  <option [value]="targetId">{{ sectionLabel(targetId) }}</option>
                                }
                              }
                            </select>
                          }
                        </div>
                      </div>
                    } @empty {
                      <div class="flex min-h-20 flex-col items-center justify-center gap-2 py-3 text-center">
                        <p class="text-xs text-gray-500">This section is empty.</p>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1.5 rounded-full bg-brand-bold px-4 py-2 text-xs font-semibold text-white hover:bg-brand-ink disabled:opacity-40"
                          [disabled]="disabled"
                          (click)="addRequested.emit(section.id)"
                        >
                          <ion-icon name="add-outline" aria-hidden="true"></ion-icon>Add a component
                        </button>
                      </div>
                    }
                  </div>
                  @if (section.components.length > 0 && !disabled) {
                    <button
                      type="button"
                      class="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-brand-bold hover:bg-brand-surface"
                      (click)="addRequested.emit(section.id)"
                    >
                      <ion-icon name="add-outline" aria-hidden="true"></ion-icon>Add component
                    </button>
                  }
                </section>
              }
            </div>
          </article>
        }
        <button
          type="button"
          class="w-full rounded-full border border-dashed border-gray-300 bg-white py-4 text-sm font-semibold text-brand-bold hover:border-brand-light disabled:opacity-40"
          [disabled]="disabled"
          (click)="pageAdded.emit()"
        >
          + Add page
        </button>
      </div>
    </main>
  `,
})
export class BuilderCanvasComponent {
  @Input({ required: true }) definition!: FormDefinition;
  @Input() selection: BuilderSelection = null;
  /** Solo lectura: se puede seleccionar para ver, pero no agregar, mover ni arrastrar. */
  @Input() disabled = false;
  @Output() readonly selected = new EventEmitter<BuilderSelection>();
  @Output() readonly pageAdded = new EventEmitter<void>();
  @Output() readonly sectionAdded = new EventEmitter<string>();
  @Output() readonly move = new EventEmitter<{ id: string; sectionId: string; index: number }>();
  /** Pide abrir la paleta con esta sección como destino. */
  @Output() readonly addRequested = new EventEmitter<string>();

  get sectionIds(): string[] {
    return this.definition.pages.flatMap((page) => page.sections.map((section) => section.id));
  }

  drop(event: CdkDragDrop<FormComponent[]>, section: FormSection): void {
    if (this.disabled) return;
    const id = (event.item.data as { id?: string } | undefined)?.id;
    const fallback = event.previousContainer.data[event.previousIndex] as
      { id?: string } | undefined;
    if (id ?? fallback?.id)
      this.move.emit({ id: id ?? fallback!.id!, sectionId: section.id, index: event.currentIndex });
  }

  dropTarget(point: ClientPoint): BuilderDropTarget | null {
    const element = document.elementFromPoint(point.clientX, point.clientY) as HTMLElement | null;
    const sectionElement = element?.closest<HTMLElement>('[data-builder-section]');
    const sectionId = sectionElement?.dataset['builderSection'];
    if (!sectionElement || !sectionId) return null;
    const components = [
      ...sectionElement.querySelectorAll<HTMLElement>('[data-builder-component]'),
    ];
    const index = components.findIndex(
      (component) =>
        point.clientY <
        component.getBoundingClientRect().top + component.getBoundingClientRect().height / 2,
    );
    return { sectionId, index: index < 0 ? components.length : index };
  }

  moveToSection(event: Event, componentId: string): void {
    const select = event.target as HTMLSelectElement;
    if (this.disabled) {
      select.value = '';
      return;
    }
    const sectionId = select.value;
    select.value = '';
    if (!sectionId) return;
    const target = this.definition.pages
      .flatMap((page) => page.sections)
      .find((section) => section.id === sectionId);
    this.move.emit({ id: componentId, sectionId, index: target?.components.length ?? 0 });
  }

  sectionLabel(sectionId: string): string {
    const sections = this.definition.pages.flatMap((page) => page.sections);
    const index = sections.findIndex((section) => section.id === sectionId);
    return sections[index]?.title || `Section ${index + 1}`;
  }

  label(type: string): string {
    return componentTypeLabel(type);
  }

  icon(type: string): string {
    return componentTypeIcon(type);
  }

  /** Label, o vista previa del contenido para bloques sin label; '' si solo quedaría el tipo. */
  title(component: FormComponent): string {
    const props = component.props ?? {};
    const raw =
      component.label ||
      (typeof props['text'] === 'string' ? props['text'] : '') ||
      (typeof props['title'] === 'string' ? props['title'] : '') ||
      (typeof props['text'] === 'object' && props['text'] != null
        ? richTextPlainText(props['text'] as RichTextDocument)
        : '');
    const text = raw.trim().slice(0, 140);
    return text && text.toLowerCase() !== this.label(component.type).toLowerCase() ? text : '';
  }
}
