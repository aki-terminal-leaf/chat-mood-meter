/**
 * batch-writer.ts — 批次寫入緩衝層
 *
 * 將高頻率的 snapshot / highlight 寫入請求緩衝起來，
 * 定時批次 flush 到資料庫，減少 PostgreSQL round-trip 次數。
 *
 * BatchWriter 是獨立的 class，不綁定在 PostgresDB 內部。
 * 任何實作 batchInsertSnapshots / batchInsertHighlights 的物件皆可注入。
 */

import type { EmotionSnapshot, HighlightMarker } from '@cmm/core/types';
import type { SnapshotBatchItem, HighlightBatchItem } from './postgres.js';

/**
 * BatchWriterDB — BatchWriter 依賴的最小介面
 * 只需要批次寫入能力，不強制整個 PostgresDB。
 */
export interface BatchWriterDB {
  batchInsertSnapshots(items: SnapshotBatchItem[]): Promise<void>;
  batchInsertHighlights(items: HighlightBatchItem[]): Promise<void>;
}

/** BatchWriter 設定選項 */
export interface BatchWriterOptions {
  /** 自動 flush 間隔（毫秒），預設 5000ms */
  flushIntervalMs?: number;
}

/**
 * BatchWriter
 *
 * 提供 addSnapshot / addHighlight 方法，緩衝資料後定時批次寫入。
 * 使用完畢後務必呼叫 destroy() 確保資料不遺失。
 *
 * @example
 * ```typescript
 * const writer = new BatchWriter(postgresDB, { flushIntervalMs: 3000 });
 * writer.addSnapshot(sessionId, snapshot);
 * writer.addHighlight(sessionId, highlight);
 * await writer.destroy(); // 確保所有資料寫入後關閉
 * ```
 */
export class BatchWriter {
  private snapshotBuffer: SnapshotBatchItem[] = [];
  private highlightBuffer: HighlightBatchItem[] = [];
  private timer: ReturnType<typeof setInterval>;
  private flushIntervalMs: number;

  /** 是否正在執行 flush（防止重入） */
  private flushing = false;

  /** 待處理的 flush Promise（給 destroy 等待用） */
  private pendingFlush: Promise<void> | null = null;

  constructor(
    private db: BatchWriterDB,
    options?: BatchWriterOptions,
  ) {
    this.flushIntervalMs = options?.flushIntervalMs ?? 5000;
    this.timer = setInterval(() => {
      this.pendingFlush = this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * 將 snapshot 加入緩衝佇列。
   * 此操作是同步的，不會等待 DB 回應。
   */
  addSnapshot(sessionId: string, snapshot: EmotionSnapshot): void {
    this.snapshotBuffer.push({ sessionId, snapshot });
  }

  /**
   * 將 highlight 加入緩衝佇列。
   * 此操作是同步的，不會等待 DB 回應。
   */
  addHighlight(sessionId: string, highlight: HighlightMarker): void {
    this.highlightBuffer.push({ sessionId, highlight });
  }

  /**
   * 立即將緩衝區內的資料批次寫入資料庫。
   * 使用 splice(0) 原子性清空 buffer，即使 DB 失敗也不會重複計入。
   * 空 buffer 時靜默跳過，不報錯。
   */
  async flush(): Promise<void> {
    // 原子性取出 buffer（清空同時拿走所有項目）
    const snaps = this.snapshotBuffer.splice(0);
    const highlights = this.highlightBuffer.splice(0);

    const tasks: Promise<void>[] = [];

    if (snaps.length > 0) {
      tasks.push(this.db.batchInsertSnapshots(snaps));
    }
    if (highlights.length > 0) {
      tasks.push(this.db.batchInsertHighlights(highlights));
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  /**
   * 停止自動 flush 計時器，並等待當前 flush 完成後執行最後一次 flush。
   * 確保所有緩衝資料都寫入資料庫後才回傳。
   */
  async destroy(): Promise<void> {
    // 先停止 timer，避免 flush 期間又觸發
    clearInterval(this.timer);

    // 等待目前進行中的 flush（若有）
    if (this.pendingFlush) {
      await this.pendingFlush.catch(() => {
        // 忽略背景 flush 的錯誤，最後一次 flush 會再試
      });
    }

    // 最後一次強制 flush，確保不遺漏資料
    await this.flush();
  }

  /** 查詢目前 snapshot buffer 大小（測試用） */
  get snapshotBufferSize(): number {
    return this.snapshotBuffer.length;
  }

  /** 查詢目前 highlight buffer 大小（測試用） */
  get highlightBufferSize(): number {
    return this.highlightBuffer.length;
  }
}
