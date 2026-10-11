"""Small CNN classifier on the single-cell crops of the SAG1 (c1) vs GRA14 (c2) control wells.

spacr.io.generate_training_dataset (metadata mode, class_metadata [['c1'], ['c2']], split by well)
then spacr.deep_spacr.train_test_model (resnet18, ImageNet init, CPU, few epochs).
Usage: env.sh make_deep.py [epochs]
"""
import json, os, pickle, shutil, sqlite3, sys, time
import common
from common import WORK, DL
common.qt_app()
import torch
torch.set_num_threads(int(os.environ.get('OMP_NUM_THREADS', '8')))

EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 8
t0 = time.time()
src = WORK / 'deep_src'
if src.exists():
    shutil.rmtree(src)
(src / 'measurements').mkdir(parents=True)
shutil.copy2(common.HIT / 'measurements' / 'measurements.db', src / 'measurements' / 'measurements.db')
con = sqlite3.connect(src / 'measurements' / 'measurements.db')
linked = missing = 0
for path, col in con.execute("select png_path, columnID from png_list where columnID in (?, ?)", (common.NEG, common.POS)):
    have = DL / 'crops' / col / os.path.basename(path)
    if not have.exists():
        missing += 1
        continue
    dest = src / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.link(have, dest)
    linked += 1
con.close()
print('linked', linked, 'missing', missing)

from spacr.io import generate_training_dataset
DATASET = {
    'src': str(src),
    'dataset_mode': 'metadata',
    'class_metadata': [[common.NEG], [common.POS]],
    'metadata_type_by': 'columnID',
    'test_split': 0.25,
    'cv_group_by': 'well',
    'balance_to_smallest': True,
    'random_seed': 42,
    'crop_source': 'png',
    'path_string': 'cell_png',
}
from spacr.settings import set_generate_training_dataset_defaults
ds = set_generate_training_dataset_defaults(dict(DATASET))
train_dir, test_dir = generate_training_dataset(ds)
print('dataset', train_dir, test_dir, ds.get('class_folder_names'))
root = os.path.dirname(str(train_dir).rstrip('/'))
counts = {split: {c: len(os.listdir(os.path.join(root, split, c))) for c in os.listdir(os.path.join(root, split))}
          for split in ('train', 'test')}
print(counts)
t1 = time.time()

from spacr.deep_spacr import train_test_model
TRAIN = {
    'src': root,
    'train': True,
    'test': True,
    'class_folder_names': ds.get('class_folder_names') or ['nc', 'pc'],
    'model_type': os.environ.get('PHENO_CNN', 'mobilenet_v3_small'),
    'init_weights': True,
    'optimizer_type': 'adamw',
    'schedule': 'cosine',
    'loss_type': 'auto',
    'normalize': True,
    'image_size': 224,
    'batch_size': 32,
    'epochs': EPOCHS,
    'learning_rate': 0.0001,
    'weight_decay': 0.00001,
    'dropout_rate': 0.1,
    'val_split': 0.1,
    'gradient_accumulation_steps': 1,
    'train_channels': ['r', 'g', 'b'],
    'augment': True,
    'use_checkpoint': False,
    'n_jobs': 4,
    'plot': False,
    'tensorboard': False,
    'intermedeate_save': False,
    'cv_group_by': 'well',
    'random_seed': 42,
    'verbose': True,
}
result = train_test_model(dict(TRAIN))
t2 = time.time()
print('train_test_model returned', result)
json.dump({'dataset_settings': DATASET, 'train_settings': TRAIN, 'root': root, 'counts': counts,
           'linked': linked, 'missing': missing, 'result': str(result),
           'seconds_dataset': t1 - t0, 'seconds_train_test': t2 - t1},
          open(WORK / 'deep_run.json', 'w'), indent=1, default=str)
