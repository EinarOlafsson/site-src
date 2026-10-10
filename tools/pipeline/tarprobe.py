import sys, tarfile, io, re
from huggingface_hub import HfFileSystem
fs = HfFileSystem()
P = 'datasets/einarolafsson/spacr-example-screen/plate1-data.tar'
f = fs.open(P, 'rb', block_size=1 << 20, cache_type='none')
SIZE = fs.size(P)

def header_at(off, span=1 << 20):
    off -= off % 512
    f.seek(off); buf = f.read(span)
    for i in range(0, len(buf) - 512, 512):
        b = buf[i:i + 512]
        if b[257:262] == b'ustar':
            try:
                ti = tarfile.TarInfo.frombuf(b, 'utf-8', 'surrogateescape')
            except Exception:
                continue
            if ti.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, b'x', b'g'):
                n = (ti.size + 511) // 512
                j = i + 512 + n * 512
                pax = buf[i + 512:i + 512 + ti.size]
                nb = buf[j:j + 512]
                real = tarfile.TarInfo.frombuf(nb, 'utf-8', 'surrogateescape')
                m = re.search(rb'\d+ path=(.*)\n', pax)
                if m:
                    real.name = m.group(1).decode()
                return off + j, real
            return off + i, ti
    return None, None

if __name__ == '__main__':
    print(SIZE)
    for frac in [0, .1, .25, .5, .75, .9, .99]:
        o, ti = header_at(int(SIZE * frac))
        print(frac, o, ti.name if ti else None, ti.size if ti else None)
