import { MAX_FRAME_BYTES } from '@social-summarizer/protocol';

// Windows Native Messaging uses a uint32 little-endian UTF-8 byte count.
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length === 0 || body.length > MAX_FRAME_BYTES) throw new Error('Frame length outside spike limit.');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class FrameDecoder {
  private header = Buffer.alloc(4);
  private headerBytes = 0;
  private body: Buffer | null = null;
  private bodyBytes = 0;
  private failed = false;

  push(chunk: Buffer): unknown[] {
    if (this.failed) throw new Error('Decoder is closed after an invalid frame.');
    const messages: unknown[] = [];
    let offset = 0;
    try {
      while (offset < chunk.length) {
        if (this.body === null) {
          const count = Math.min(4 - this.headerBytes, chunk.length - offset);
          chunk.copy(this.header, this.headerBytes, offset, offset + count);
          this.headerBytes += count;
          offset += count;
          if (this.headerBytes < 4) continue;
          const length = this.header.readUInt32LE();
          if (length === 0 || length > MAX_FRAME_BYTES) throw new Error(`Invalid frame length ${length}; maximum ${MAX_FRAME_BYTES} bytes.`);
          this.body = Buffer.alloc(length);
          this.bodyBytes = 0;
        }
        const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
        chunk.copy(this.body, this.bodyBytes, offset, offset + count);
        offset += count;
        this.bodyBytes += count;
        if (this.bodyBytes === this.body.length) {
          const json = new TextDecoder('utf-8', { fatal: true }).decode(this.body);
          messages.push(JSON.parse(json));
          this.body = null;
          this.headerBytes = 0;
          this.bodyBytes = 0;
        }
      }
      return messages;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  finish(): void {
    if (this.failed || this.headerBytes !== 0 || this.body !== null) throw new Error('Input closed with an incomplete or invalid frame.');
  }
}
