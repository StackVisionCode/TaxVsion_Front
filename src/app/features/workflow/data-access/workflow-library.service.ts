import { Injectable, computed, signal } from '@angular/core';
import { WorkflowDoc } from './workflow.model';

/** Clave del ÚNICO workflow que existía antes. Solo se lee, para migrar y borrar. */
const LEGACY_KEY = 'tvf.workflow.v1';
/** Índice de la biblioteca: lo justo para pintar la tabla sin abrir cada documento. */
const INDEX_KEY = 'tvf.workflows.index.v1';
/** Prefijo de cada documento completo. */
const DOC_PREFIX = 'tvf.workflow.doc.';

/** Fila de la tabla: resumen barato de un workflow. */
export interface WorkflowSummary {
  id: string;
  name: string;
  updatedAtIso: string;
  stepCount: number;
  connectionCount: number;
  collaboratorCount: number;
  annotationCount: number;
}

/**
 * Biblioteca de workflows.
 *
 * Antes solo cabía UNO: todo se guardaba en la clave fija `tvf.workflow.v1`, así que
 * renombrar no creaba otro documento — pisaba el único que había, y el anterior no se
 * podía recuperar. Aquí cada workflow tiene su propia clave y un índice aparte.
 *
 * El índice existe para que la tabla no tenga que parsear cada documento: con imágenes
 * incrustadas un documento pesa megas, y listar diez sería leerlos todos para sacar cuatro
 * campos. Si el índice falta o viene roto se reconstruye leyendo las claves de documento,
 * que son la fuente de verdad.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowLibraryService {
  private readonly _items = signal<readonly WorkflowSummary[]>([]);
  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);

  constructor() {
    this.migrateLegacy();
    this.refresh();
  }

  /** Relee el índice. Público porque el builder guarda por su cuenta. */
  refresh(): void {
    this._items.set(this.readIndex().sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso)));
  }

  read(id: string): WorkflowDoc | null {
    try {
      const raw = localStorage.getItem(DOC_PREFIX + id);
      return raw ? (JSON.parse(raw) as WorkflowDoc) : null;
    } catch {
      return null;
    }
  }

  /** Guarda el documento y refleja su resumen en el índice. Lanza si no hay sitio. */
  write(doc: WorkflowDoc): void {
    localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(doc));
    const summary = summarize(doc);
    const index = this.readIndex().filter(item => item.id !== doc.id);
    this.writeIndex([...index, summary]);
    this.refresh();
  }

  remove(id: string): void {
    try {
      localStorage.removeItem(DOC_PREFIX + id);
    } catch {
      // Da igual: lo que manda para la tabla es el índice.
    }
    this.writeIndex(this.readIndex().filter(item => item.id !== id));
    this.refresh();
  }

  /** Copia con id, nombre y fecha nuevos. Los pasos conservan su id: son internos al doc. */
  duplicate(id: string): WorkflowDoc | null {
    const source = this.read(id);
    if (!source) {
      return null;
    }
    const copy: WorkflowDoc = {
      ...source,
      id: newWorkflowId(),
      name: `${source.name} (copy)`,
      updatedAtIso: new Date().toISOString(),
    };
    this.write(copy);
    return copy;
  }

  // ---------- Índice ----------

  private readIndex(): WorkflowSummary[] {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      const parsed = raw ? (JSON.parse(raw) as WorkflowSummary[]) : null;
      if (Array.isArray(parsed) && parsed.every(item => typeof item?.id === 'string')) {
        return parsed;
      }
    } catch {
      // Índice ilegible: se reconstruye abajo.
    }
    return this.rebuildIndex();
  }

  /** Reconstruye el índice a partir de los documentos guardados. */
  private rebuildIndex(): WorkflowSummary[] {
    const summaries: WorkflowSummary[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(DOC_PREFIX)) {
          continue;
        }
        const doc = this.read(key.slice(DOC_PREFIX.length));
        if (doc) {
          summaries.push(summarize(doc));
        }
      }
      this.writeIndex(summaries);
    } catch {
      // Sin almacenamiento: la biblioteca queda vacía en memoria.
    }
    return summaries;
  }

  private writeIndex(items: WorkflowSummary[]): void {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(items));
    } catch {
      // El documento ya se guardó; el índice se puede reconstruir de él.
    }
  }

  /**
   * Sube el workflow único del formato viejo a la biblioteca. Se hace una vez: después se
   * borra la clave vieja para no resucitarlo en cada arranque.
   */
  private migrateLegacy(): void {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) {
        return;
      }
      const doc = JSON.parse(raw) as WorkflowDoc;
      if (doc?.steps?.length) {
        this.write({ ...doc, id: doc.id || newWorkflowId() });
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Un documento viejo ilegible no debe impedir abrir la biblioteca.
    }
  }
}

export function newWorkflowId(): string {
  return `wf-${Math.random().toString(36).slice(2, 10)}`;
}

function summarize(doc: WorkflowDoc): WorkflowSummary {
  return {
    id: doc.id,
    name: doc.name,
    updatedAtIso: doc.updatedAtIso,
    stepCount: doc.steps?.length ?? 0,
    connectionCount: doc.connections?.length ?? 0,
    collaboratorCount: doc.collaborators?.length ?? 0,
    annotationCount: doc.annotations?.length ?? 0,
  };
}
