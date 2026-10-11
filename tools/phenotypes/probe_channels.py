"""Which channel separates the SAG1 (c1) and GRA14 (c2) control wells: pathogen/cytoplasm mean ratio per channel."""
import sqlite3
import pandas as pd
import common
con = sqlite3.connect(f'file:{common.HIT}/measurements/measurements.db?mode=ro', uri=True)
p = pd.read_sql('select * from pathogen', con)
c = pd.read_sql('select * from cytoplasm', con)
print(p.columns[:12].tolist())
key = ['plateID', 'rowID', 'columnID', 'fieldID']
pid = [k for k in p.columns if 'cell_id' in k]
print(pid)
p = p[p.columnID.isin(['c1', 'c2'])]
c = c[c.columnID.isin(['c1', 'c2'])]
pm = p.groupby(key + ['pathogen_cell_id'])[[f'pathogen_channel_{i}_mean_intensity' for i in range(4)]].mean()
cm = c.set_index(key + ['object_label'])[[f'cytoplasm_channel_{i}_mean_intensity' for i in range(4)]]
cm.index.names = key + ['pathogen_cell_id']
j = pm.join(cm, how='inner')
for i in range(4):
    j[f'r{i}'] = j[f'pathogen_channel_{i}_mean_intensity'] / j[f'cytoplasm_channel_{i}_mean_intensity']
print(len(j))
print(j.groupby(level='columnID')[[f'r{i}' for i in range(4)] + [f'pathogen_channel_{i}_mean_intensity' for i in range(4)]].median().T)
