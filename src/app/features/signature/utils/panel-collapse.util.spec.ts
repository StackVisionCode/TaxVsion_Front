import { readPanelCollapsed, writePanelCollapsed } from './panel-collapse.util';

describe('panel-collapse util', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('por defecto el panel está desplegado y recuerda el estado plegado', () => {
    expect(readPanelCollapsed('k')).toBe(false);
    writePanelCollapsed('k', true);
    expect(readPanelCollapsed('k')).toBe(true);
    writePanelCollapsed('k', false);
    expect(readPanelCollapsed('k')).toBe(false);
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('sin localStorage no rompe: lee false e ignora la escritura', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPanelCollapsed('k')).toBe(false);
    expect(() => writePanelCollapsed('k', true)).not.toThrow();
  });
});
