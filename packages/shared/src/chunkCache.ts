import { TileType, CHUNK_SIZE, chunkKeyFor, chunkOriginFromKey, type WorldGrid } from "./map.js";

export interface TileRangeEntry {
  col: number;
  row: number;
  tileType: number;
  elevation: number;
}

interface TileCell {
  tileType: number;
  elevation: number;
}

// Fetches every explicitly-painted tile within a rectangular tile-space
// range (inclusive both ends) — gaps are the caller's responsibility to
// default-fill. Implemented against Prisma on the server, against the
// ranged REST endpoint on the client.
export type FetchRangeFn = (
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
) => Promise<TileRangeEntry[]>;

const DEFAULT_MAX_CHUNKS = 2000;
const DEFAULT_CELL: TileCell = { tileType: TileType.Grass, elevation: 0 };

// Backs a WorldGrid with a sparse, on-demand-loaded tile source. See
// map.ts's WorldGrid doc comment for why "chunk hasn't loaded yet" and
// "nothing was ever painted here" both simply resolve to Grass rather than
// needing a separate loading state — tileAt() is synchronous and always
// returns *something* immediately, kicking off a background load the first
// time a chunk is touched and self-correcting once that resolves.
export class ChunkTileCache implements WorldGrid {
  readonly tileSize: number;
  private readonly fetchRange: FetchRangeFn;
  private readonly maxChunks: number;
  private chunks = new Map<string, TileCell[][]>();
  private loading = new Set<string>();

  constructor(tileSize: number, fetchRange: FetchRangeFn, maxChunks = DEFAULT_MAX_CHUNKS) {
    this.tileSize = tileSize;
    this.fetchRange = fetchRange;
    this.maxChunks = maxChunks;
  }

  tileAt(col: number, row: number): number {
    return this.cellAt(col, row).tileType;
  }

  elevationAt(col: number, row: number): number {
    return this.cellAt(col, row).elevation;
  }

  private cellAt(col: number, row: number): TileCell {
    const key = chunkKeyFor(col, row);
    const chunk = this.chunks.get(key);
    if (chunk) {
      const { chunkCol, chunkRow } = chunkOriginFromKey(key);
      return chunk[row - chunkRow * CHUNK_SIZE][col - chunkCol * CHUNK_SIZE];
    }
    void this.loadChunk(key);
    return DEFAULT_CELL;
  }

  // Proactively loads every chunk overlapping a tile-space rectangle in one
  // fetch (rather than one request per chunk) — callers should pass a
  // single bounding box already covering everything they need warmed, e.g.
  // the union of several players' preload radii.
  async warm(minCol: number, minRow: number, maxCol: number, maxRow: number): Promise<void> {
    const minChunkCol = Math.floor(minCol / CHUNK_SIZE);
    const minChunkRow = Math.floor(minRow / CHUNK_SIZE);
    const maxChunkCol = Math.floor(maxCol / CHUNK_SIZE);
    const maxChunkRow = Math.floor(maxRow / CHUNK_SIZE);

    let allCached = true;
    outer: for (let cc = minChunkCol; cc <= maxChunkCol; cc++) {
      for (let cr = minChunkRow; cr <= maxChunkRow; cr++) {
        if (!this.chunks.has(`${cc},${cr}`)) {
          allCached = false;
          break outer;
        }
      }
    }
    if (allCached) return;

    for (let cc = minChunkCol; cc <= maxChunkCol; cc++) {
      for (let cr = minChunkRow; cr <= maxChunkRow; cr++) {
        this.loading.add(`${cc},${cr}`);
      }
    }

    try {
      const fromCol = minChunkCol * CHUNK_SIZE;
      const fromRow = minChunkRow * CHUNK_SIZE;
      const toCol = (maxChunkCol + 1) * CHUNK_SIZE - 1;
      const toRow = (maxChunkRow + 1) * CHUNK_SIZE - 1;
      const entries = await this.fetchRange(fromCol, fromRow, toCol, toRow);
      this.applyEntries(entries, minChunkCol, minChunkRow, maxChunkCol, maxChunkRow);
    } catch (err) {
      console.error("Failed to warm map chunks:", err);
    } finally {
      for (let cc = minChunkCol; cc <= maxChunkCol; cc++) {
        for (let cr = minChunkRow; cr <= maxChunkRow; cr++) {
          this.loading.delete(`${cc},${cr}`);
        }
      }
    }
  }

  // Whether the chunk containing (col,row) has actually finished loading
  // (as opposed to currently resolving as the Grass fallback) — used by
  // renderers that want to know when it's worth re-drawing a chunk that was
  // first painted before its real data arrived.
  isChunkLoaded(col: number, row: number): boolean {
    return this.chunks.has(chunkKeyFor(col, row));
  }

  // Drops every cached/loading chunk so the next tileAt() call re-fetches
  // from scratch — used when the map's content changes underneath an
  // already-running room/scene (see WorldRoom's "maps" content-reload).
  clear(): void {
    this.chunks.clear();
    this.loading.clear();
  }

  private async loadChunk(key: string): Promise<void> {
    if (this.loading.has(key) || this.chunks.has(key)) return;
    this.loading.add(key);
    const { chunkCol, chunkRow } = chunkOriginFromKey(key);
    try {
      const fromCol = chunkCol * CHUNK_SIZE;
      const fromRow = chunkRow * CHUNK_SIZE;
      const entries = await this.fetchRange(fromCol, fromRow, fromCol + CHUNK_SIZE - 1, fromRow + CHUNK_SIZE - 1);
      this.applyEntries(entries, chunkCol, chunkRow, chunkCol, chunkRow);
    } catch (err) {
      console.error(`Failed to load map chunk ${key}:`, err);
    } finally {
      this.loading.delete(key);
    }
  }

  // Builds every chunk in the covered range as a dense, Grass-filled array
  // first (so chunks with zero painted tiles still get cached — otherwise
  // they'd never satisfy `this.chunks.has(key)` and would be re-fetched on
  // every single query), then overlays the painted entries on top.
  private applyEntries(
    entries: TileRangeEntry[],
    minChunkCol: number,
    minChunkRow: number,
    maxChunkCol: number,
    maxChunkRow: number,
  ): void {
    for (let cc = minChunkCol; cc <= maxChunkCol; cc++) {
      for (let cr = minChunkRow; cr <= maxChunkRow; cr++) {
        const key = `${cc},${cr}`;
        if (!this.chunks.has(key)) {
          const blank: TileCell[][] = Array.from({ length: CHUNK_SIZE }, () =>
            Array.from({ length: CHUNK_SIZE }, () => ({ ...DEFAULT_CELL }) as TileCell),
          );
          this.setChunk(key, blank);
        }
      }
    }
    for (const entry of entries) {
      const chunkCol = Math.floor(entry.col / CHUNK_SIZE);
      const chunkRow = Math.floor(entry.row / CHUNK_SIZE);
      const chunk = this.chunks.get(`${chunkCol},${chunkRow}`);
      if (!chunk) continue; // outside the range we just built — shouldn't happen
      chunk[entry.row - chunkRow * CHUNK_SIZE][entry.col - chunkCol * CHUNK_SIZE] = {
        tileType: entry.tileType,
        elevation: entry.elevation,
      };
    }
  }

  private setChunk(key: string, data: TileCell[][]): void {
    this.chunks.set(key, data);
    if (this.chunks.size > this.maxChunks) {
      const oldest = this.chunks.keys().next().value;
      if (oldest !== undefined) this.chunks.delete(oldest);
    }
  }
}
