import { describe, expect, it } from 'vitest';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { BuilderCanvasComponent } from './builder-canvas.component';

describe('BuilderCanvasComponent card title', () => {
  const canvas = new BuilderCanvasComponent();
  const component = (value: Partial<FormComponent>) =>
    ({ id: 'fd_abcdefghij', type: 'text', ...value }) as FormComponent;

  it('does not repeat the type when the label is the type name', () => {
    expect(canvas.title(component({ type: 'taxId', label: 'Tax ID' }))).toBe('');
    expect(canvas.label('taxId')).toBe('Tax ID');
  });

  it('keeps a custom label next to the type chip', () => {
    expect(canvas.title(component({ type: 'taxId', label: 'Your SSN' }))).toBe('Your SSN');
  });

  it('previews the text of a block without label', () => {
    const paragraph = component({
      type: 'paragraph',
      props: {
        text: {
          type: 'doc',
          blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bring your W-2.' }] }],
        },
      },
    });
    expect(canvas.title(paragraph)).toContain('Bring your W-2.');
  });
});
