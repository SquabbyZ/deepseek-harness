// One-off generator: emit a valid solid-color icon.ico (256x256 PNG-wrapped)
// so tauri_build's Windows resource step succeeds without the tauri CLI.
// Replace with `tauri icon <source.png>` before a real distribution build.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(here, { recursive: true })

const W = 256
const H = 256
// DeepSeek-ish indigo fill.
const row = Buffer.alloc(W * 4)
for (let x = 0; x < W; x++) {
  row[x * 4] = 0x4d
  row[x * 4 + 1] = 0x6b
  row[x * 4 + 2] = 0xf2
  row[x * 4 + 3] = 0xff
}
// Raw scanlines, each prefixed with filter byte 0.
const raw = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0
  row.copy(raw, y * (1 + W * 4) + 1)
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

// ICO: 6-byte header + one 16-byte entry + the PNG payload.
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0) // reserved
icoHeader.writeUInt16LE(1, 2) // type: icon
icoHeader.writeUInt16LE(1, 4) // count

const entry = Buffer.alloc(16)
entry[0] = 0 // width 256
entry[1] = 0 // height 256
entry[2] = 0 // palette
entry[3] = 0 // reserved
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(png.length, 8) // bytes in resource
entry.writeUInt32LE(22, 12) // offset

writeFileSync(`${here}/icon.ico`, Buffer.concat([icoHeader, entry, png]))
console.log(`wrote ${here}/icon.ico (${png.length} bytes png payload)`)
