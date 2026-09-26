import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepare } from '../../evaluation/prepare.mjs';

const cases = JSON.parse(readFileSync(new URL('../../evaluation/cases.json', import.meta.url), 'utf8'));
test('evaluation conditions isolate evidence and keep rubrics out of model inputs', () => {
  const runs = prepare(cases, { availableAt: '2026-09-26T12:00:00.000Z' });
  assert.equal(runs.length, cases.length * 3);
  for (const c of cases) {
    const [none, raw, understanding] = runs.filter(r => r.caseId === c.id);
    assert.deepEqual([none.condition, raw.condition, understanding.condition], ['none', 'raw', 'raw-and-understanding']);
    for (const run of [none, raw, understanding]) {
      assert.equal(run.response, null); assert.equal(run.usefulness, 'user-unrated');
      assert.equal(run.externalResearch, 'disabled'); assert.equal(run.outcome, 'not-observed');
      assert.ok(run.prompt.includes(c.request));
      assert.ok(!run.prompt.includes(JSON.stringify(c.must)));
      assert.ok(!run.prompt.includes(JSON.stringify(c.avoid)));
    }
    assert.ok(!none.prompt.includes(JSON.stringify(c.raw)));
    assert.ok(raw.prompt.includes(JSON.stringify(c.raw)));
    assert.ok(!raw.prompt.includes(JSON.stringify(c.understanding)));
    assert.ok(understanding.prompt.includes(JSON.stringify(c.raw)));
    assert.ok(understanding.prompt.includes(JSON.stringify(c.understanding)));
  }
});
