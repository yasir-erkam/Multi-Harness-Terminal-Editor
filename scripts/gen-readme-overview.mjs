import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// Dependency-free pixel artwork for the README; this is a workflow diagram.
const width = 1440, height = 530;
const pixels = Buffer.alloc(width * height * 4);
const colors = { bg: [15, 23, 42], card: [26, 39, 61], white: [232, 240, 255], muted: [161, 180, 205], blue: [104, 184, 255], green: [104, 222, 181] };
function rect(x, y, w, h, color) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
        const i = (py * width + px) * 4;
        pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
    }
}
const alphabet = {
 A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',0:'01110/10001/10011/10101/11001/10001/01110',1:'00100/01100/00100/00100/00100/00100/01110',2:'01110/10001/00001/00010/00100/01000/11111',3:'11110/00001/00001/01110/00001/00001/11110','-':'00000/00000/00000/11111/00000/00000/00000','>':'10000/01000/00100/00010/00100/01000/10000','/':'00001/00010/00010/00100/01000/01000/10000','.':'00000/00000/00000/00000/00000/00110/00110'
};
function text(value, x, y, scale, color) {
    for (const char of value.toUpperCase()) {
        const glyph = alphabet[char];
        if (glyph) glyph.split('/').forEach((row, dy) => [...row].forEach((bit, dx) => {
            if (bit === '1') rect(x + dx * scale, y + dy * scale, scale, scale, color);
        }));
        x += scale * 6;
    }
}
rect(0, 0, width, height, colors.bg);
rect(48, 42, 48, 5, colors.green);
text('MULTI-HARNESS TERMINAL EDITOR', 48, 72, 5, colors.white);
text('YOUR AGENTS. YOUR PROJECT. EDITOR-AREA TERMINALS.', 48, 135, 3, colors.muted);
const cards = [
    ['01', 'SELECT AN AGENT', 'SINGLE-CLICK TO BROWSE', 'PROJECT CONVERSATIONS'],
    ['02', 'OPEN OR RESUME', 'DOUBLE-CLICK TO LAUNCH', 'OR SELECT A SAVED SESSION'],
    ['03', 'KEEP WORKING', 'USE NATIVE TERMINAL TABS', 'SWITCH VIA OPEN TERMINALS']
];
cards.forEach(([number, title, line1, line2], index) => {
    const x = 48 + index * 456;
    rect(x, 210, 432, 220, colors.card);
    rect(x, 210, 432, 3, colors.blue);
    text(number, x + 24, 238, 3, colors.green);
    text(title, x + 24, 286, 3, colors.white);
    text(line1, x + 24, 348, 2, colors.muted);
    text(line2, x + 24, 374, 2, colors.muted);
});
text('WORKFLOW OVERVIEW / SAVED SESSIONS FOR SUPPORTED AGENTS', 48, 474, 2, colors.muted);
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
const scanlines = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
writeFileSync(new URL('../media/readme-overview.png', import.meta.url), Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
]));
