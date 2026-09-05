/**
 * Smoke tests for gaia-hardness predictor — ADR-136 Track Q
 *
 * All tests are mock-based (no live API calls, no HF token, $0 cost).
 *
 * Test matrix:
 *   1. Feature extraction: math question fires requiresMath + qword_calc
 *   2. Feature extraction: simple factual question has low complexity signal
 *   3. Feature extraction: question with file attachment fires has_file_attachment
 *   4. Feature extraction: multi-hop question fires multi_hop_signal
 *   5. Cold-start fallback: untrained predictor returns medium with confidence=0.5
 *   6. Train on mock data: predictor becomes trained after ≥ 10 examples
 *   7. Trained predictor: math-heavy question predicts harder than trivial question
 *   8. Export/import: weights round-trip through JSON without loss
 *
 * Refs: ADR-136, #2156
 */

import assert from 'node:assert/strict';
import { extractFeatures, FEATURE_LABELS } from './features.js';
import { HardnessPredictor, type LabeledExample, type DifficultyClass } from './predictor.js';
import type { GaiaQuestion } from '../gaia-loader.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeQuestion(text: string, overrides: Partial<GaiaQuestion> = {}): GaiaQuestion {
  return {
    task_id: 'smoke-test',
    level: 1,
    question: text,
    final_answer: 'X',
    file_name: null,
    file_path: null,
    ...overrides,
  };
}

function labelIndex(label: string): number {
  return FEATURE_LABELS.indexOf(label);
}

// ---------------------------------------------------------------------------
// Test 1: Math question fires expected features
// ---------------------------------------------------------------------------

function testMathQuestionFeatures(): void {
  const q = makeQuestion(
    'What is 15 multiplied by 4? Calculate the exact product.',
  );
  const fv = extractFeatures(q);

  const calcIdx = labelIndex('qword_calc_compute');
  const mathIdx = labelIndex('requires_math');
  const numIdx = labelIndex('has_numeric');

  assert.ok(calcIdx >= 0, 'qword_calc_compute feature not found');
  assert.ok(mathIdx >= 0, 'requires_math feature not found');
  assert.ok(numIdx >= 0, 'has_numeric feature not found');

  assert.equal(fv.values[numIdx], 1, 'has_numeric should be 1 for "15 multiplied by 4"');
  // "Calculate" or "what" triggers calc compute or requires_math
  const eitherMath = fv.values[calcIdx] === 1 || fv.values[mathIdx] === 1;
  assert.ok(eitherMath, 'math question should fire qword_calc_compute or requires_math');

  console.log('  [PASS] Test 1: math question fires expected features');
}

// ---------------------------------------------------------------------------
// Test 2: Simple factual question has low complexity
// ---------------------------------------------------------------------------

function testSimpleFactualQuestion(): void {
  const q = makeQuestion('What is the capital of France?');
  const fv = extractFeatures(q);

  assert.equal(fv.values.length, 17, 'feature vector should have 17 dims');

  const multiHopIdx = labelIndex('multi_hop_signal');
  const toolIdx = labelIndex('tool_implication_norm');
  const fileIdx = labelIndex('has_file_attachment');

  assert.equal(fv.values[multiHopIdx], 0, 'simple question should have no multi-hop signal');
  assert.equal(fv.values[toolIdx], 0, 'simple question should have no tool implication');
  assert.equal(fv.values[fileIdx], 0, 'simple question should have no file attachment');

  // Word count should be normalised well below 1
  const wordNormIdx = labelIndex('len_words_norm');
  assert.ok(fv.values[wordNormIdx] < 0.3, 'short question should have normalised word count < 0.3');

  console.log('  [PASS] Test 2: simple factual question has low complexity signal');
}

// ---------------------------------------------------------------------------
// Test 3: File attachment fires has_file_attachment
// ---------------------------------------------------------------------------

function testFileAttachmentFeature(): void {
  const q = makeQuestion('Analyse the attached PDF document and extract the table.', {
    file_name: 'document.pdf',
    file_path: '/tmp/document.pdf',
  });
  const fv = extractFeatures(q);

  const fileIdx = labelIndex('has_file_attachment');
  const toolIdx = labelIndex('tool_implication_norm');

  assert.equal(fv.values[fileIdx], 1, 'question with file_name should have has_file_attachment=1');
  assert.ok(fv.values[toolIdx] > 0, 'PDF question should have tool_implication > 0');

  console.log('  [PASS] Test 3: file attachment fires has_file_attachment');
}

// ---------------------------------------------------------------------------
// Test 4: Multi-hop question fires multi_hop_signal
// ---------------------------------------------------------------------------

function testMultiHopFeature(): void {
  const q = makeQuestion(
    'Who was the president of the country that won the most gold medals at the Olympics that was held in the city that hosted the 1936 Games?',
  );
  const fv = extractFeatures(q);

  const multiHopIdx = labelIndex('multi_hop_signal');
  assert.equal(fv.values[multiHopIdx], 1, 'multi-hop question should fire multi_hop_signal');

  console.log('  [PASS] Test 4: multi-hop question fires multi_hop_signal');
}

// ---------------------------------------------------------------------------
// Test 5: Cold-start fallback returns medium with confidence=0.5
// ---------------------------------------------------------------------------

function testColdStartFallback(): void {
  const predictor = new HardnessPredictor();
  assert.equal(predictor.isTrained, false, 'new predictor should not be trained');

  const q = makeQuestion('What is the capital of France?');
  const result = predictor.predict(q);

  assert.equal(result.difficulty, 'medium', 'cold-start should return medium');
  assert.equal(result.confidence, 0.5, 'cold-start should return confidence=0.5');
  assert.equal(result.budget.model, 'sonnet', 'medium budget should use sonnet');
  assert.equal(result.budget.maxTurns, 8, 'medium budget should have maxTurns=8');
  assert.equal(result.budget.votingAttempts, 1, 'medium budget should have votingAttempts=1');

  console.log('  [PASS] Test 5: cold-start fallback returns medium with confidence=0.5');
}

// ---------------------------------------------------------------------------
// Test 6: Becomes trained after ≥ 10 labelled examples
// ---------------------------------------------------------------------------

function testBecomesTrainedWith10Examples(): void {
  const predictor = new HardnessPredictor();

  // Generate 15 mock examples (mix of correct/incorrect)
  const examples: LabeledExample[] = [];
  for (let i = 0; i < 15; i++) {
    examples.push({
      question: makeQuestion(`Mock question number ${i} about topic ${i % 3}`),
      wasCorrect: i % 3 !== 0,
      turns: 3 + (i % 6),
    });
  }

  assert.equal(predictor.isTrained, false, 'should not be trained before training');
  predictor.train(examples);
  assert.equal(predictor.isTrained, true, 'should be trained after ≥10 examples');

  console.log('  [PASS] Test 6: predictor becomes trained after ≥ 10 examples');
}

// ---------------------------------------------------------------------------
// Test 7: Trained predictor scores math question harder than trivial question
// ---------------------------------------------------------------------------

function testTrainedRelativeHardness(): void {
  const predictor = new HardnessPredictor({ conservativeMode: false });

  // Train on 20 examples with clear pattern:
  // - Short simple questions → correct (easy)
  // - Long multi-step questions → incorrect (hard)
  const examples: LabeledExample[] = [];
  for (let i = 0; i < 10; i++) {
    examples.push({
      question: makeQuestion(`What is the capital of country ${i}?`),
      wasCorrect: true,
      turns: 2,
    });
    examples.push({
      question: makeQuestion(
        `Calculate the exact percentage difference between ${i * 100} and ${i * 100 + 50}, ` +
        `then multiply by the number of years between 1990 and 2023. ` +
        `Express as a decimal rounded to 3 places.`,
      ),
      wasCorrect: false,
      turns: 12,
    });
  }

  predictor.train(examples);

  const trivialQ = makeQuestion('What is the capital of France?');
  const mathQ = makeQuestion(
    'Calculate the exact percentage difference between 750 and 1250, ' +
    'then multiply by the number of years between 1990 and 2023. ' +
    'Express as a decimal rounded to 3 places.',
  );

  const trivialResult = predictor.predict(trivialQ);
  const mathResult = predictor.predict(mathQ);

  // The difficulty ordering should not put math as easier than trivial.
  const ORDER: Record<DifficultyClass, number> = { easy: 0, medium: 1, hard: 2 };
  assert.ok(
    ORDER[mathResult.difficulty] >= ORDER[trivialResult.difficulty],
    `math question (${mathResult.difficulty}) should be ≥ trivial (${trivialResult.difficulty})`,
  );

  console.log(
    `  [PASS] Test 7: math="${mathResult.difficulty}" (conf=${mathResult.confidence.toFixed(2)}) ≥ trivial="${trivialResult.difficulty}" (conf=${trivialResult.confidence.toFixed(2)})`,
  );
}

// ---------------------------------------------------------------------------
// Test 8: Weights round-trip through JSON export/import
// ---------------------------------------------------------------------------

function testWeightRoundTrip(): void {
  const predictor = new HardnessPredictor();

  const examples: LabeledExample[] = [];
  for (let i = 0; i < 12; i++) {
    examples.push({
      question: makeQuestion(`Question ${i}`),
      wasCorrect: i % 2 === 0,
      turns: 4 + i,
    });
  }
  predictor.train(examples);

  const exported = predictor.export();
  assert.ok(exported !== null, 'exported state should not be null after training');

  const predictor2 = new HardnessPredictor();
  predictor2.import(exported!);
  assert.equal(predictor2.isTrained, true, 'imported predictor should be trained');

  // Both predictors should give the same result for the same question.
  const q = makeQuestion('How many sides does a hexagon have?');
  const r1 = predictor.predict(q);
  const r2 = predictor2.predict(q);
  assert.equal(r1.difficulty, r2.difficulty, 'exported/imported predictor should give same difficulty');
  assert.ok(
    Math.abs(r1.confidence - r2.confidence) < 0.001,
    'exported/imported predictor should give same confidence',
  );

  console.log('  [PASS] Test 8: weights round-trip through export/import without loss');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runSmoke(): Promise<void> {
  console.log('\n=== gaia-hardness predictor.smoke.ts — ADR-136 Track Q ===');
  console.log('(mock-based, no live API, $0 cost)\n');

  let passed = 0;
  let total = 0;

  function run(name: string, fn: () => void): void {
    total++;
    try {
      fn();
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  run('Feature extraction: math question', testMathQuestionFeatures);
  run('Feature extraction: simple factual', testSimpleFactualQuestion);
  run('Feature extraction: file attachment', testFileAttachmentFeature);
  run('Feature extraction: multi-hop signal', testMultiHopFeature);
  run('Cold-start fallback: medium + confidence=0.5', testColdStartFallback);
  run('Train: becomes trained with ≥10 examples', testBecomesTrainedWith10Examples);
  run('Trained: math harder than trivial', testTrainedRelativeHardness);
  run('Export/import: weights round-trip', testWeightRoundTrip);

  console.log(`\n=== Summary: ${passed}/${total} tests passed ===`);

  if (passed < total) {
    process.exit(1);
  }
}

// Run when invoked directly.
if (
  process.argv[1]?.endsWith('predictor.smoke.js') ||
  process.argv[1]?.endsWith('predictor.smoke.ts')
) {
  runSmoke().catch((err) => {
    console.error('Smoke crashed:', err);
    process.exit(2);
  });
}

export { runSmoke };
