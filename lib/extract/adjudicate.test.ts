// Safety tests for the adjudication guard. Run: npx tsx --test lib/extract/adjudicate.test.ts
//
// The rule under test: Nemotron may add a value the parser missed, confirm the parser, or raise a
// hazard — it may NEVER lower one. These cases are the reason the guard exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAdjudications, preCheck, wouldLower, type AdjudicationCase, type Decision } from './adjudicate';
import type { ReconciledValue } from './reconcile';

const value = (over: Partial<ReconciledValue> = {}): ReconciledValue => ({
  periodLabel: 'TODAY', periodIndex: 0, field: 'ripCurrentRisk', subArea: null, value: 'High',
  rawSpan: 'Rip Current Risk*...........High.', charStart: 100, charEnd: 133,
  extractor: 'regex', confidence: 'low', model: null, adjudicationReason: null, ...over,
});

const kase = (over: Partial<AdjudicationCase> = {}): AdjudicationCase => ({
  id: 'TODAY|ripCurrentRisk|', periodLabel: 'TODAY', field: 'ripCurrentRisk', subArea: null,
  parserValue: 'High', parserSpan: 'Rip Current Risk*...........High.',
  nemotronValue: 'Low', nemotronQuote: 'Rip Current Risk*...........Low.',
  nemotronSpan: 'Rip Current Risk*...........Low.', nemotronCharStart: 100, nemotronCharEnd: 132,
  excerpt: '.TODAY...\nRip Current Risk*...........High.', ...over,
});

const decide = (choice: Decision['choice'], id = 'TODAY|ripCurrentRisk|'): Decision[] => [{ id, choice, reason: 'test' }];

test('wouldLower detects a categorical downgrade', () => {
  assert.equal(wouldLower('ripCurrentRisk', 'High', 'Low'), true);
  assert.equal(wouldLower('ripCurrentRisk', 'Low', 'High'), false);
  assert.equal(wouldLower('ripCurrentRisk', 'Moderate', 'Moderate'), false);
});

test('wouldLower detects a measured downgrade by upper bound', () => {
  assert.equal(wouldLower('surfHeight', '4 to 6 feet', 'around 2 feet'), true);
  assert.equal(wouldLower('surfHeight', 'around 2 feet', '4 to 6 feet'), false);
});

test('a downgrade is refused: the parser value stays and is flagged low confidence', () => {
  const { values, applied } = applyAdjudications([value()], [kase()], decide('nemotron'), 'model-x');
  assert.equal(values.length, 1);
  assert.equal(values[0].value, 'High', 'the hazard value must not be lowered');
  assert.equal(values[0].confidence, 'low');
  assert.equal(applied[0].outcome, 'refused_downgrade');
});

test('an upgrade is allowed', () => {
  const vals = [value({ value: 'Low', rawSpan: 'Rip Current Risk*...........Low.' })];
  const c = kase({ parserValue: 'Low', nemotronValue: 'High', nemotronQuote: 'Rip Current Risk*...........High.' });
  const { values, applied } = applyAdjudications(vals, [c], decide('nemotron'), 'model-x');
  assert.equal(values[0].value, 'High');
  assert.equal(values[0].extractor, 'adjudicated');
  assert.equal(applied[0].outcome, 'took_nemotron');
});

test('a value the parser missed is added, with real provenance', () => {
  const c = kase({ parserValue: null, nemotronValue: 'Moderate', nemotronCharStart: 210, nemotronCharEnd: 246,
                   nemotronSpan: '   East of Ocean Isle Beach.Moderate.' });
  const { values, applied } = applyAdjudications([], [c], decide('nemotron'), 'model-x');
  assert.equal(values.length, 1);
  assert.equal(values[0].value, 'Moderate');
  assert.equal(values[0].charStart, 210, 'an added value keeps the verified source offsets');
  assert.equal(applied[0].outcome, 'added_missing');
});

test('a value with no verified span is never stored', () => {
  const c = kase({ parserValue: null, nemotronSpan: null, nemotronCharStart: null, nemotronCharEnd: null });
  const { values, applied } = applyAdjudications([], [c], decide('nemotron'), 'model-x');
  assert.equal(values.length, 0, 'no provenance means no value');
  assert.equal(applied[0].outcome, 'no_decision');
});

test('choosing the parser keeps its value and records the reasoning', () => {
  const { values, applied } = applyAdjudications([value()], [kase()], decide('parser'), 'model-x');
  assert.equal(values[0].value, 'High');
  assert.equal(values[0].extractor, 'adjudicated');
  assert.equal(values[0].adjudicationReason, 'test');
  assert.equal(applied[0].outcome, 'kept_parser');
});

test('"neither" leaves the parser value in place at low confidence', () => {
  const { values, applied } = applyAdjudications([value({ confidence: 'medium' })], [kase()], decide('neither'), 'model-x');
  assert.equal(values[0].value, 'High');
  assert.equal(values[0].confidence, 'low');
  assert.equal(applied[0].outcome, 'flagged_neither');
});

test('pre-check resolves a non-category parser value without asking the model', () => {
  const c = kase({ parserValue: 'Low Expect hazardous conditions near inlets', nemotronValue: 'Low' });
  const { decisions, remaining } = preCheck([c]);
  assert.equal(remaining.length, 0, 'the model is never asked');
  assert.equal(decisions[0].choice, 'nemotron');
});

test('pre-check resolves a parser value that spans multiple source lines', () => {
  const c = kase({ field: 'surfHeight', parserValue: 'Around 2 feet Expect hazardous conditions',
                   parserSpan: 'Surf Height.................Around 2 feet.\n                            Expect hazardous conditions',
                   nemotronValue: 'Around 2 feet' });
  const { decisions, remaining } = preCheck([c]);
  assert.equal(remaining.length, 0);
  assert.match(decisions[0].reason, /multiple source lines/);
});

test('pre-check leaves a genuine disagreement for the model', () => {
  const { decisions, remaining } = preCheck([kase()]);   // High vs Low, both valid categories
  assert.equal(decisions.length, 0);
  assert.equal(remaining.length, 1, 'a real conflict still goes to Nemotron');
});

test('a missing decision changes nothing', () => {
  const { values, applied } = applyAdjudications([value()], [kase()], [], 'model-x');
  assert.deepEqual(values, [value()]);
  assert.equal(applied[0].outcome, 'no_decision');
});
