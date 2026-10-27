// Arhive .tar (format ustar), fără dependențe; comprimarea o face zlib din Node.
// Destul pentru copiile de siguranță: fișiere obișnuite, nume relative, fără legături.

const BLOCK = 512;

function header(name, size, mtime) {
  const h = Buffer.alloc(BLOCK);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) { // numele lungi se împart în prefix (155) + nume (100)
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Nume prea lung pentru tar: ${name}`);
    prefix = name.slice(0, cut); name = name.slice(cut + 1);
  }
  const put = (str, off, len) => h.write(str, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100);
  put(oct(0o644, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12); put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8); put('0', 156, 1);
  put('ustar\0', 257, 6); put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

// entries: [{name, data: Buffer, mtime?}]
export function pack(entries) {
  const parts = [];
  for (const e of entries) {
    parts.push(header(e.name, e.data.length, e.mtime ?? Date.now()), e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

export function unpack(buf) {
  const out = [];
  for (let off = 0; off + BLOCK <= buf.length;) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every(b => b === 0)) break;
    const str = (o, l) => h.subarray(o, o + l).toString('utf8').replace(/\0.*$/s, '');
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== parseInt(str(148, 8).trim(), 8)) throw new Error('Arhivă tar coruptă (sumă de control greșită).');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const prefix = str(345, 155), name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const type = str(156, 1) || '0';
    off += BLOCK;
    if (off + size > buf.length) throw new Error('Arhivă tar trunchiată.');
    if (type === '0') out.push({name, data: Buffer.from(buf.subarray(off, off + size)), mtime: parseInt(str(136, 12).trim(), 8) * 1000});
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
