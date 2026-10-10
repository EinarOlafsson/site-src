import io, os, re, sys, tarfile, sqlite3
from huggingface_hub import HfFileSystem

DB = sys.argv[1]
OUT = sys.argv[2]
ROW, COL, FLD, WELL = sys.argv[3:7]
fs = HfFileSystem()
P = 'datasets/einarolafsson/spacr-example-screen/plate1-data.tar'
f = fs.open(P, 'rb', block_size=1 << 20, cache_type='none')
SIZE = fs.size(P)

def header_at(off, span=1 << 20):
    off -= off % 512
    f.seek(off); buf = f.read(span)
    for i in range(0, len(buf) - 1024, 512):
        b = buf[i:i + 512]
        if b[257:262] != b'ustar':
            continue
        try:
            ti = tarfile.TarInfo.frombuf(b, 'utf-8', 'surrogateescape')
        except Exception:
            continue
        if ti.type in (tarfile.XHDTYPE, b'x'):
            pax = buf[i + 512:i + 512 + ti.size]
            m = re.search(rb'\d+ path=(.*)\n', pax)
            j = i + 512 + ((ti.size + 511) // 512) * 512
            real = tarfile.TarInfo.frombuf(buf[j:j + 512], 'utf-8', 'surrogateescape')
            if m:
                real.name = m.group(1).decode()
            return off + i, real.name
        return off + i, ti.name
    return None, None

con = sqlite3.connect(DB)
paths = [r[0] for r in con.execute(
    "select png_path from png_list where rowID=? and columnID=? and fieldID=?", (ROW, COL, FLD))]
want = set(paths)
prefixes = sorted({'/'.join(p.split('/')[:4]) + '/' for p in paths})
os.makedirs(OUT, exist_ok=True)
got = 0
for pre in prefixes:
    lo, hi = 0, SIZE
    while hi - lo > (8 << 20):
        mid = (lo + hi) // 2
        o, name = header_at(mid)
        if name is None or name >= pre:
            hi = mid
        else:
            lo = o
    start, _ = header_at(lo)
    span = 64 << 20
    while True:
        f.seek(start); buf = f.read(span)
        tf = tarfile.open(fileobj=io.BytesIO(buf), mode='r|')
        seen_after = False
        try:
            for m in tf:
                if m.name in want:
                    data = tf.extractfile(m).read()
                    with open(os.path.join(OUT, os.path.basename(m.name)), 'wb') as fh:
                        fh.write(data)
                    want.discard(m.name); got += 1
                if m.name > pre and not m.name.startswith(pre):
                    seen_after = True
                    break
        except (tarfile.ReadError, EOFError):
            pass
        if seen_after or not any(w.startswith(pre) for w in want):
            break
        span *= 2
    print(pre, 'done; remaining', len(want), flush=True)
print('fetched', got, 'missing', sorted(want))
