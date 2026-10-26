import { describe, expect, it } from 'vitest';
import { validateRichText, type RichTextDocument } from './rich-text';

describe('validateRichText', () => {
  it('keeps validating blocks when the document type is invalid, like .NET', () => {
    const document = {
      type: 'page',
      blocks: [{ type: 'quote', children: [] }],
    } as RichTextDocument;

    expect(validateRichText(document, '/help', 1_000).map((item) => item.path)).toEqual([
      '/help',
      '/help/blocks/0',
    ]);
  });

  it('applies the server https rule to links', () => {
    const link = (href: string): RichTextDocument => ({
      type: 'doc',
      blocks: [
        {
          type: 'paragraph',
          children: [{ type: 'link', href, children: [{ type: 'text', text: 'Site' }] }],
        },
      ],
    });

    expect(validateRichText(link('https://example.com'), '/help', 1_000)).toEqual([]);
    expect(validateRichText(link('https:example.com'), '/help', 1_000)[0]?.code).toBe(
      'richtext.invalid_link',
    );
  });
});
