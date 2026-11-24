import { invoke } from "@tauri-apps/api/core";

export interface PdfSource {
  length: number;
  read(begin: number, end: number): Promise<Uint8Array>;
  close(): void;
}
const MAX_IPC_BYTES = 256 * 1024;
export async function openPdfSource(contentHash: string): Promise<PdfSource> {
  const { sessionId, length } = await invoke<{ sessionId: string; length: number }>("pdf_range_open", { contentHash });
  let closed = false;
  return { length,
    async read(begin, end) {
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > length || end - begin > 32 * 1024 * 1024) {
        throw new Error("PDF 页面所需数据超出单次读取上限");
      }
      const bytes = new Uint8Array(end - begin);
      for (let offset = begin; offset < end; offset += MAX_IPC_BYTES) {
        if (closed) throw new Error("PDF 已关闭");
        const next = Math.min(end, offset + MAX_IPC_BYTES);
        const raw = await invoke<ArrayBuffer>("pdf_range_read", { sessionId, begin: offset, end: next });
        if (raw.byteLength !== next - offset || closed) throw new Error("PDF 读取已中断");
        bytes.set(new Uint8Array(raw), offset - begin);
      }
      return bytes;
    },
    close() {
      if (closed) return;
      closed = true;
      void invoke("pdf_range_close", { sessionId }).catch(console.error);
    },
  };
}
