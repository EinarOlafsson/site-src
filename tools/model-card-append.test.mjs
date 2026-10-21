import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("published card append preserves historical sets and uses exact source metrics", () => {
  const result = spawnSync("python", ["-I", "-c", `
import copy, importlib.util, json, pathlib
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location('collector', root / 'tools/models/collect.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
data = json.loads((root / 'data/models.json').read_text())
card_model = next(g for g in data['groups'] if g['id'] == 'plaque')['models'].pop()
old = copy.deepcopy(data)
key = card_model['key']
card = {'schema': 'spacr-model-card-v2', 'key': key, 'repo_id': 'einarolafsson/example',
        'family': 'plaque', 'display_name': 'Plaque v5', 'status': 'default',
        'about': {'status': 'Default'}, 'scores': {'stock_model': 'cpsam_v2',
        'holdout': {'n_fields': 153, 'n_objects': 6540, 'rule': 'Strict held-out test'},
        'rows': [{'key': 'object_f1', 'this': 0.8157148643175375, 'stock': 0.2267648864333947}]}}
zoo = {key: {'repo_id': 'einarolafsson/example'}}
added = m.append_model_card(data, zoo, card, key, 'https://source/card', 'https://source/zoo')
assert added['metrics']['f1_50'] == {'finetuned': 0.816, 'vanilla': 0.227}
assert added['metrics']['precision'] is None
assert added['test'] == {'size': '153', 'objects': 6540, 'source': 'Strict held-out test'}
assert added['sources'] == ['https://source/zoo', 'https://source/card']
next(g for g in data['groups'] if g['id'] == 'plaque')['models'].pop()
assert data == old
for field, bad in [('key', 'wrong'), ('repo_id', 'other/repo'), ('schema', 'unknown')]:
    invalid = copy.deepcopy(card); invalid[field] = bad
    try: m.append_model_card(copy.deepcopy(old), zoo, invalid, key, 'card', 'zoo')
    except ValueError: pass
    else: raise AssertionError('accepted mismatched ' + field)
m.append_model_card(data, zoo, card, key, 'card', 'zoo')
try: m.append_model_card(data, zoo, card, key, 'card', 'zoo')
except ValueError: pass
else: raise AssertionError('accepted duplicate')
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
