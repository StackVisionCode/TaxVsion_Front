import { describe, expect, it } from 'vitest';
import { htmlToPlainText, plainTextToHtml } from './mail.model';

/**
 * `textBody` es lo que lee quien tiene el html desactivado y lo que indexan muchas
 * bandejas. Estos casos son los que fallaban con la conversión a base de expresiones
 * regulares, y salían en el correo del destinatario.
 */
describe('htmlToPlainText', () => {
  it('no vuelve a decodificar lo ya decodificado', () => {
    // Escribir literalmente "&lt;" deja "&amp;lt;" en el editor. Resolver `&amp;` y luego
    // `&lt;` lo convertía en "<": el destinatario leía otra cosa de la que se escribió.
    expect(htmlToPlainText('&amp;lt;')).toBe('&lt;');
    expect(htmlToPlainText('A &amp;amp; B')).toBe('A &amp; B');
    expect(htmlToPlainText('Tom &amp; Jerry')).toBe('Tom & Jerry');
  });

  it('corta línea al ABRIR el bloque, no solo al cerrarlo', () => {
    // El contenteditable deja la primera línea suelta y mete las siguientes en <div>.
    // Cortando solo en el cierre, "uno" y "dos" salían pegados.
    expect(htmlToPlainText('uno<div>dos</div><div>tres</div>')).toBe('uno\ndos\ntres');
  });

  it('separa párrafos y respeta los <br>', () => {
    expect(htmlToPlainText('<p>uno</p><p>dos</p>')).toBe('uno\ndos');
    expect(htmlToPlainText('uno<br>dos')).toBe('uno\ndos');
  });

  it('marca los elementos de lista', () => {
    expect(htmlToPlainText('<ul><li>uno</li><li>dos</li></ul>')).toBe('• uno\n• dos');
  });

  it('deja fuera el contenido de style y script', () => {
    // Un correo pegado trae su CSS: sin esto acababa dentro del cuerpo plano.
    expect(htmlToPlainText('<style>.x{color:red}</style><p>Hola</p>')).toBe('Hola');
    expect(htmlToPlainText('<script>alert(1)</script><p>Hola</p>')).toBe('Hola');
  });

  it('anuncia las imágenes en vez de dejar un hueco mudo', () => {
    expect(htmlToPlainText('<p>Mira <img alt="el gráfico"> esto</p>')).toBe('Mira [el gráfico] esto');
    expect(htmlToPlainText('<img src="x.png">')).toBe('[image]');
  });

  it('el espacio duro es un espacio normal y no se acumulan líneas en blanco', () => {
    expect(htmlToPlainText('a&nbsp;b')).toBe('a b');
    expect(htmlToPlainText('<p>a</p><br><br><br><p>b</p>')).toBe('a\n\nb');
  });

  it('vacío o solo etiquetas es cadena vacía, no basura', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
    expect(htmlToPlainText('   ')).toBe('');
    expect(htmlToPlainText('<div></div>')).toBe('');
  });
});

describe('plainTextToHtml', () => {
  it('escapa el markup en vez de dejarlo pasar', () => {
    expect(plainTextToHtml('<b>hola</b>')).toBe('<p>&lt;b&gt;hola&lt;/b&gt;</p>');
  });

  it('un salto de línea es un <br>', () => {
    expect(plainTextToHtml('uno\ndos')).toBe('<p>uno<br>dos</p>');
  });
});

/**
 * Las dos funciones son los extremos de la misma migración: el composer produce html y
 * degrada a texto; la respuesta rápida produce texto y sube a html.
 */
describe('ida y vuelta', () => {
  it('texto → html → texto devuelve el original', () => {
    for (const original of ['Hola', 'uno\ndos', 'Tom & Jerry', '<b>literal</b>', 'comillas "así"']) {
      expect(htmlToPlainText(plainTextToHtml(original))).toBe(original);
    }
  });
});
