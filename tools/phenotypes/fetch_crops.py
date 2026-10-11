"""Fetch the single-cell PNG crops of the control wells from plate1-data.tar by HTTP range reads.

Untrusted download: only PNG members named in the hit cut's png_list are written,
under their basename, into DL/crops/<columnID>/.
Usage: env.sh fetch_crops.py <columnID> [<columnID> ...]
       env.sh fetch_crops.py --paths <json with {"candidates": {key: [png_path, ...]}}> <outdir>
"""
import io, json, os, re, sqlite3, sys, tarfile, time
import common
from huggingface_hub import HfFileSystem

cols = sys.argv[1:]
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


if cols and cols[0] == '--paths':
    import pathlib
    rec = json.load(open(cols[1]))
    jobs = {'paths': sorted({p for v in rec['candidates'].values() for p in v})}
    outdir = pathlib.Path(cols[2])
    cols = []
else:
    jobs = None
con = sqlite3.connect(f'file:{common.HIT}/measurements/measurements.db?mode=ro', uri=True)
log = {}
t0 = time.time()
groups = [(c, [r[0] for r in con.execute("select png_path from png_list where columnID=?", (c,))], common.DL / 'crops' / c) for c in cols]
if jobs:
    groups = [('paths', jobs['paths'], outdir)]
for col, paths, out in groups:
    want = set(paths)
    out.mkdir(parents=True, exist_ok=True)
    want = {p for p in want if not (out / os.path.basename(p)).exists()}
    prefixes = sorted({'/'.join(p.split('/')[:4]) + '/' for p in want})
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
        span = 32 << 20
        while True:
            f.seek(start); buf = f.read(span)
            tf = tarfile.open(fileobj=io.BytesIO(buf), mode='r|')
            seen_after = False
            try:
                for m in tf:
                    if m.name in want and m.isfile() and m.name.endswith('.png'):
                        data = tf.extractfile(m).read()
                        (out / os.path.basename(m.name)).write_bytes(data)
                        want.discard(m.name); got += 1
                    if m.name > pre and not m.name.startswith(pre):
                        seen_after = True
                        break
            except (tarfile.ReadError, EOFError):
                pass
            if seen_after or not any(w.startswith(pre) for w in want):
                break
            span *= 2
        print(col, pre, 'remaining', len(want), round(time.time() - t0), 's', flush=True)
    log[col] = {'requested': len(paths), 'fetched_now': got, 'missing': sorted(want)}
print(json.dumps(log, indent=1))
(common.DL / f'fetch_log_{"_".join(log)}.json').write_text(json.dumps(log, indent=1))
