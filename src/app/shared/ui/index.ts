// Barrel de shared/ui (el único permitido en el repo). Se agregan acá las piezas pensadas para
// reutilizarse entre features.
export { FileViewerComponent } from './file-viewer/file-viewer.component';
export type { FileViewerItem, FileViewerDownload, FileViewerKind } from './file-viewer/file-viewer.model';
export { detectViewerKind } from './file-viewer/file-viewer.model';
