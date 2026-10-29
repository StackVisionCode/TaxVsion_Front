import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { RichTextDocument } from '@shared/utils/data-collection/rich-text';
import { validateRichText } from '@shared/utils/data-collection/rich-text';
import { RichTextEditorComponent } from './rich-text-editor.component';

const multiBlock: RichTextDocument = {
  type: 'doc',
  blocks: [
    { type: 'heading', level: 2, children: [{ type: 'text', text: 'Before you start' }] },
    {
      type: 'paragraph',
      align: 'justify',
      children: [
        { type: 'text', text: 'Please have your ' },
        { type: 'text', text: 'W-2', marks: ['bold', 'underline'] },
        { type: 'link', href: 'https://irs.gov', children: [{ type: 'text', text: 'IRS info' }] },
      ],
    },
    {
      type: 'bulletList',
      items: [[{ type: 'text', text: 'Photo ID' }], [{ type: 'text', text: 'Last return' }]],
    },
  ],
};

function paragraph(text: string): RichTextDocument {
  return { type: 'doc', blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }] };
}

async function setup(document: RichTextDocument | null) {
  await TestBed.configureTestingModule({ imports: [RichTextEditorComponent] }).compileComponents();
  const fixture = TestBed.createComponent(RichTextEditorComponent);
  fixture.componentRef.setInput('document', document);
  fixture.detectChanges();
  const emitted: RichTextDocument[] = [];
  fixture.componentInstance.documentChange.subscribe((value) => emitted.push(value));
  const surface = fixture.nativeElement.querySelector('[contenteditable]') as HTMLDivElement;
  return { fixture, component: fixture.componentInstance, surface, emitted };
}

function select(fixture: ComponentFixture<RichTextEditorComponent>, start: number, end = start) {
  fixture.componentInstance['select']({ start, end });
}

function inputEvent(inputType: string, init: Partial<InputEvent> = {}): InputEvent {
  return {
    inputType,
    data: null,
    cancelable: true,
    isComposing: false,
    dataTransfer: null,
    preventDefault: () => undefined,
    ...init,
  } as unknown as InputEvent;
}

describe('RichTextEditorComponent', () => {
  it('accepts paste as plain text and never creates HTML nodes', async () => {
    const { component, surface, fixture } = await setup(null);
    select(fixture, 0);
    component.paste({
      preventDefault: () => undefined,
      clipboardData: { getData: () => '<img src=x onerror=alert(1)>Safe' },
    } as unknown as ClipboardEvent);
    expect(surface.querySelector('img')).toBeNull();
    expect(surface.textContent).toContain('<img');
  });

  it('gives the textbox an accessible name', async () => {
    const { surface, fixture } = await setup(null);
    expect(surface.getAttribute('role')).toBe('textbox');
    expect(surface.getAttribute('aria-label')).toBe('Rich text content');
    fixture.componentRef.setInput('ariaLabelledby', 'description-label');
    fixture.detectChanges();
    expect(surface.getAttribute('aria-labelledby')).toBe('description-label');
    expect(surface.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps every block when typing into a multi-block document', async () => {
    const { component, fixture, emitted, surface } = await setup(multiBlock);
    expect(surface.querySelectorAll('[data-line]')).toHaveLength(4);
    // "Before you start" + separador = 17; el cursor queda tras "Please".
    select(fixture, 17 + 'Please'.length);
    component.beforeInput(inputEvent('insertText', { data: '!' }));

    const result = emitted.at(-1)!;
    expect(result.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
    ]);
    expect(result.blocks[0].children).toEqual([{ type: 'text', text: 'Before you start' }]);
    expect(result.blocks[1]).toEqual({
      type: 'paragraph',
      align: 'justify',
      children: [
        { type: 'text', text: 'Please! have your ' },
        { type: 'text', text: 'W-2', marks: ['bold', 'underline'] },
        { type: 'link', href: 'https://irs.gov', children: [{ type: 'text', text: 'IRS info' }] },
      ],
    });
    expect(result.blocks[2].items).toHaveLength(2);
    expect(validateRichText(result, '/doc', 8000)).toEqual([]);
  });

  it('splits and merges lines without losing the other blocks', async () => {
    const { component, fixture, emitted } = await setup(multiBlock);
    const listStart = 17 + 'Please have your W-2IRS info'.length + 1;
    select(fixture, listStart + 'Photo ID'.length);
    component.beforeInput(inputEvent('insertParagraph'));
    component.beforeInput(inputEvent('insertText', { data: 'SSN card' }));
    expect(emitted.at(-1)!.blocks[2].items!.map((item) => item[0].text)).toEqual([
      'Photo ID',
      'SSN card',
      'Last return',
    ]);

    select(fixture, 17);
    component.beforeInput(inputEvent('deleteContentBackward'));
    const merged = emitted.at(-1)!;
    expect(merged.blocks).toHaveLength(2);
    expect(merged.blocks[0].type).toBe('heading');
    expect(merged.blocks[1].type).toBe('bulletList');
  });

  it('applies marks and color only to the selected range', async () => {
    const { component, fixture, emitted } = await setup(paragraph('Hello world'));
    select(fixture, 6, 11);
    component.toggleMark('bold');
    expect(emitted.at(-1)!.blocks[0].children).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', marks: ['bold'] },
    ]);

    select(fixture, 0, 5);
    component.setColor({ target: { value: 'danger' } } as unknown as Event);
    expect(emitted.at(-1)!.blocks[0].children).toEqual([
      { type: 'text', text: 'Hello', color: 'danger' },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'world', marks: ['bold'] },
    ]);

    // Escribir dentro del tramo en negrita hereda su formato.
    select(fixture, 8);
    component.beforeInput(inputEvent('insertText', { data: 'X' }));
    expect(emitted.at(-1)!.blocks[0].children!.at(-1)).toEqual({
      type: 'text',
      text: 'woXrld',
      marks: ['bold'],
    });
  });

  it('turns on a mark for the next characters when the selection is collapsed', async () => {
    const { component, fixture, emitted } = await setup(paragraph('Hi'));
    select(fixture, 2);
    component.toggleMark('italic');
    component.beforeInput(inputEvent('insertText', { data: '!' }));
    expect(emitted.at(-1)!.blocks[0].children).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'text', text: '!', marks: ['italic'] },
    ]);
  });

  it('links only the selection and rejects non-https addresses', async () => {
    const { component, fixture, emitted, surface } = await setup(paragraph('Read the IRS guide'));
    select(fixture, 9, 12);
    component.openLinkDialog();
    component.linkUrl.set('javascript:alert(1)');
    component.applyLink();
    expect(component.linkError()).not.toBeNull();
    component.linkUrl.set('http://irs.gov');
    component.applyLink();
    expect(emitted).toHaveLength(0);

    component.linkUrl.set('https://irs.gov');
    component.applyLink();
    expect(emitted.at(-1)!.blocks[0].children).toEqual([
      { type: 'text', text: 'Read the ' },
      { type: 'link', href: 'https://irs.gov', children: [{ type: 'text', text: 'IRS' }] },
      { type: 'text', text: ' guide' },
    ]);
    const anchor = surface.querySelector('a')!;
    expect(anchor.getAttribute('href')).toBe('https://irs.gov');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');

    select(fixture, 10);
    component.openLinkDialog();
    expect(component.linkEditing()).toBe(true);
    component.removeLink();
    expect(emitted.at(-1)!.blocks[0].children).toEqual([
      { type: 'text', text: 'Read the IRS guide' },
    ]);
  });

  it('reconciles IME composition without flattening formatting', async () => {
    const { component, fixture, emitted, surface } = await setup({
      type: 'doc',
      blocks: [
        { type: 'heading', level: 3, children: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: ['bold'] },
          ],
        },
      ],
    });
    select(fixture, 6 + 'Hello wo'.length);
    component.compositionStart();
    // insertCompositionText no se cancela: el navegador escribe en el DOM.
    component.beforeInput(inputEvent('insertCompositionText', { data: 'か', isComposing: true }));
    const bold = surface.querySelector('[data-line="1"] .font-bold')!.firstChild as Text;
    bold.data = 'woかrld';
    const range = document.createRange();
    range.setStart(bold, 3);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    component.onInput({ isComposing: true } as unknown as Event);
    expect(emitted).toHaveLength(0);
    component.compositionEnd();

    const result = emitted.at(-1)!;
    expect(result.blocks[0]).toEqual({
      type: 'heading',
      level: 3,
      children: [{ type: 'text', text: 'Title' }],
    });
    expect(result.blocks[1].children).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'woかrld', marks: ['bold'] },
    ]);
  });

  it('keeps a mark chosen with a collapsed caret for text composed with an IME', async () => {
    const { component, fixture, emitted, surface } = await setup(paragraph('Hi'));
    select(fixture, 2);
    component.toggleMark('bold');
    component.compositionStart();
    component.beforeInput(inputEvent('insertCompositionText', { data: 'か', isComposing: true }));
    const text = surface.querySelector('[data-line="0"]')!.lastChild!.firstChild as Text;
    text.data = 'Hiか';
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    component.captureSelection();
    component.compositionEnd();

    expect(emitted.at(-1)!.blocks[0].children).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'text', text: 'か', marks: ['bold'] },
    ]);
  });

  it('handles autocorrect replacements, cancelable or not', async () => {
    const { component, fixture, emitted, surface } = await setup(paragraph('I saw teh cat'));
    select(fixture, 6, 9);
    component.beforeInput(
      inputEvent('insertReplacementText', {
        dataTransfer: { getData: () => 'the' } as unknown as DataTransfer,
      }),
    );
    expect(emitted.at(-1)!.blocks[0].children).toEqual([{ type: 'text', text: 'I saw the cat' }]);

    // No cancelable (Android): el navegador cambia el DOM y `input` lo reconcilia.
    component.beforeInput(inputEvent('insertReplacementText', { cancelable: false }));
    const text = surface.querySelector('[data-line="0"] span')!.firstChild as Text;
    text.data = 'I saw the cats';
    component.onInput({ isComposing: false } as unknown as Event);
    expect(emitted.at(-1)!.blocks[0].children).toEqual([{ type: 'text', text: 'I saw the cats' }]);
  });

  it('ignores the echo of its own emission and keeps undo working', async () => {
    const { component, fixture, emitted } = await setup(paragraph('Draft'));
    select(fixture, 5);
    component.beforeInput(inputEvent('insertText', { data: 's' }));
    fixture.componentRef.setInput('document', structuredClone(emitted.at(-1)!));
    fixture.detectChanges();
    component.beforeInput(inputEvent('historyUndo'));
    expect(emitted.at(-1)!.blocks[0].children).toEqual([{ type: 'text', text: 'Draft' }]);
  });
});
