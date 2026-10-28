import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/**
 * 依存なしの PNG 書き出し（単色 + 簡単な模様）。
 * モック作画で «ローカルに実在する画像» を作るために使う。作画チェック（画像を読む）の動作確認が
 * オフラインでもできる。
 */
export function writePlaceholderPng(file: string, width: number, height: number, seed: number): void {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const base = [(seed * 53) % 120 + 100, (seed * 97) % 120 + 100, (seed * 31) % 120 + 100];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      const stripe = ((x >> 4) + (y >> 4)) % 2 === 0 ? 0 : -18;
      const border = x < 6 || y < 6 || x >= width - 6 || y >= height - 6 ? -70 : 0;
      raw[o] = Math.max(0, base[0] + stripe + border);
      raw[o + 1] = Math.max(0, base[1] + stripe + border);
      raw[o + 2] = Math.max(0, base[2] + stripe + border);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
}
