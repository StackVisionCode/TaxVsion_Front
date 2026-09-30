import { DEFAULT_EDITOR_PANELS, readEditorPanels, writeEditorPanels } from './editor-panels.util';

describe('editor-panels util', () => {
  beforeEach(() => localStorage.clear());

  it('sin nada guardado devuelve ambos paneles abiertos', () => {
    expect(readEditorPanels('request')).toEqual(DEFAULT_EDITOR_PANELS);
  });

  it('persiste y recupera por editor (claves independientes)', () => {
    writeEditorPanels('request', { leftCollapsed: true, rightCollapsed: false });
    writeEditorPanels('template', { leftCollapsed: false, rightCollapsed: true });

    expect(readEditorPanels('request')).toEqual({ leftCollapsed: true, rightCollapsed: false });
    expect(readEditorPanels('template')).toEqual({ leftCollapsed: false, rightCollapsed: true });
  });

  it('tolera JSON corrupto o valores no booleanos', () => {
    localStorage.setItem('taxvision.signature.editorPanels.request', '{oops');
    expect(readEditorPanels('request')).toEqual(DEFAULT_EDITOR_PANELS);

    localStorage.setItem('taxvision.signature.editorPanels.request', JSON.stringify({ leftCollapsed: 'yes' }));
    expect(readEditorPanels('request')).toEqual(DEFAULT_EDITOR_PANELS);
  });

  it('si localStorage lanza, lee defaults y no rompe al escribir', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readEditorPanels('request')).toEqual(DEFAULT_EDITOR_PANELS);
    expect(() => writeEditorPanels('request', { leftCollapsed: true, rightCollapsed: true })).not.toThrow();

    get.mockRestore();
    set.mockRestore();
  });
});
