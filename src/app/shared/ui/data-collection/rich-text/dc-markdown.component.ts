import { Component, Input } from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { isHttpsUri } from '@shared/utils/data-collection/formats';
import type {
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
} from '@shared/utils/data-collection/rich-text';

/**
 * Render seguro de RichText. Uso: `<app-dc-markdown [document]="help" />`.
 * Solo pinta nodos validados y nunca interpreta HTML.
 */
@Component({
  selector: 'app-dc-markdown',
  imports: [NgClass, NgTemplateOutlet],
  templateUrl: './dc-markdown.component.html',
})
export class DcMarkdownComponent {
  @Input() document: RichTextDocument | null | undefined = null;

  blocks(): readonly RichTextBlock[] {
    return Array.isArray(this.document?.blocks) ? this.document.blocks : [];
  }

  inlineClasses(node: RichTextInline): string[] {
    return [
      node.marks?.includes('bold') ? 'font-semibold' : '',
      node.marks?.includes('italic') ? 'italic' : '',
      node.marks?.includes('underline') ? 'underline' : '',
      this.colorClass(node.color),
    ].filter(Boolean);
  }

  blockClasses(block: RichTextBlock): string[] {
    return [
      (
        {
          left: 'text-left',
          center: 'text-center',
          right: 'text-right',
          justify: 'text-justify',
        } as Record<string, string>
      )[block.align ?? ''] ?? '',
      (
        {
          sans: 'font-sans',
          serif: 'font-serif',
          script1: 'font-script1',
          script2: 'font-script2',
        } as Record<string, string>
      )[block.font ?? ''] ?? '',
    ].filter(Boolean);
  }

  safeHref(href: string | null | undefined): string | null {
    // Misma regla que el servidor y, además, el navegador debe leerlo como https.
    if (!href || !isHttpsUri(href)) return null;
    try {
      return new URL(href).protocol === 'https:' ? href : null;
    } catch {
      return null;
    }
  }

  private colorClass(value: string | null | undefined): string {
    return (
      (
        {
          ink: 'text-gray-900',
          secondary: 'text-gray-700',
          muted: 'text-gray-600',
          brand: 'text-brand-bold',
          accent: 'text-orange-700',
          success: 'text-emerald-700',
          warning: 'text-amber-700',
          danger: 'text-red-700',
          info: 'text-sky-700',
        } as Record<string, string>
      )[value ?? ''] ?? ''
    );
  }
}
