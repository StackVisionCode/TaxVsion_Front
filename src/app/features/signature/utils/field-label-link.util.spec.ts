import { buildMaskedLabel, isSafeHttpUrl, labelDisplayText, linkHost, parseFieldLabel } from './field-label-link.util';

describe('field-label-link.util', () => {
  it('detecta una URL en crudo cuando toda la etiqueta es un enlace', () => {
    expect(parseFieldLabel('https://irs.gov/forms/8879')).toEqual({
      url: 'https://irs.gov/forms/8879',
      text: null,
      masked: false,
      display: 'https://irs.gov/forms/8879',
    });
    expect(parseFieldLabel('  http://example.com ').url).toBe('http://example.com');
  });

  it('un texto con una URL dentro NO se trata como enlace', () => {
    expect(parseFieldLabel('See https://example.com for details').url).toBeNull();
    expect(parseFieldLabel('Social Security Number').url).toBeNull();
    expect(parseFieldLabel(null).display).toBe('');
  });

  it('lee el formato enmascarado [texto](url)', () => {
    const parsed = parseFieldLabel('[Read the terms](https://example.com/terms)');
    expect(parsed).toEqual({ url: 'https://example.com/terms', text: 'Read the terms', masked: true, display: 'Read the terms' });
    expect(labelDisplayText('[Read the terms](https://example.com/terms)')).toBe('Read the terms');
  });

  it('solo acepta http/https: javascript:, data: y mailto: no son enlaces', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,hi')).toBe(false);
    expect(isSafeHttpUrl('mailto:a@b.com')).toBe(false);
    expect(isSafeHttpUrl('https://')).toBe(false);
    expect(parseFieldLabel('[Click](javascript:alert(1))').url).toBeNull();
    expect(parseFieldLabel('[Click](javascript:alert(1))').masked).toBe(false);
  });

  it('buildMaskedLabel limpia los corchetes y paréntesis del texto y cae a la URL si no hay texto', () => {
    expect(buildMaskedLabel('Read [the] (terms)', 'https://example.com')).toBe('[Read the terms](https://example.com)');
    expect(buildMaskedLabel('   ', 'https://example.com')).toBe('https://example.com');
    expect(parseFieldLabel(buildMaskedLabel('Terms', 'https://example.com/a?b=1')).url).toBe('https://example.com/a?b=1');
  });

  it('linkHost devuelve el dominio sin www', () => {
    expect(linkHost('https://www.irs.gov/forms')).toBe('irs.gov');
    expect(linkHost('not a url')).toBe('');
    expect(linkHost(null)).toBe('');
  });
});
