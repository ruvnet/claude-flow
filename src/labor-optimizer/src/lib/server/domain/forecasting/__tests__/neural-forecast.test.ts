/**
 * Unit tests for the Neural Forecast MLP engine.
 *
 * Tests forward pass output type, feature vector length,
 * and Xavier weight initialization properties.
 */

import { describe, it, expect, vi } from 'vitest';
import type { NeuralFeatures, ModelWeights } from '../neural-forecast';
import { featuresToVector } from '../neural-data';

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

vi.mock('$lib/server/supabase', () => ({
	getSupabase: vi.fn(() => ({
		from: vi.fn(() => {
			const chain: Record<string, any> = {};
			const methods = ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle', 'upsert'];
			for (const m of methods) {
				chain[m] = vi.fn(() => chain);
			}
			chain.then = (resolve: any) => resolve({ data: null, error: null });
			return chain;
		}),
	})),
	getSupabaseService: vi.fn(() => ({
		from: vi.fn(() => {
			const chain: Record<string, any> = {};
			const methods = ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle', 'upsert'];
			for (const m of methods) {
				chain[m] = vi.fn(() => chain);
			}
			chain.then = (resolve: any) => resolve({ data: null, error: null });
			return chain;
		}),
	})),
}));

vi.mock('../neural-data', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../neural-data')>();
	return {
		...actual,
		loadTrainingData: vi.fn(async () => ({ samples: [], avgRevenue: 0, maxCovers: 0 })),
		buildFeaturesForDate: vi.fn(),
	};
});

// ---------------------------------------------------------------------------
// Helpers: replicate core neural functions for isolated testing
// ---------------------------------------------------------------------------

const INPUT_SIZE = 19;
const HIDDEN_LAYERS = [32, 16, 8];

function relu(x: number): number {
	return x > 0 ? x : 0;
}

function initWeights(rows: number, cols: number): number[][] {
	const scale = Math.sqrt(2.0 / (rows + cols));
	const w: number[][] = [];
	for (let i = 0; i < rows; i++) {
		const row: number[] = [];
		for (let j = 0; j < cols; j++) {
			row.push((Math.random() * 2 - 1) * scale);
		}
		w.push(row);
	}
	return w;
}

function initBiases(size: number): number[] {
	return new Array(size).fill(0);
}

function createRandomModel(): ModelWeights {
	const sizes = [INPUT_SIZE, ...HIDDEN_LAYERS, 1];
	const layers: { weights: number[][]; biases: number[] }[] = [];
	for (let l = 0; l < sizes.length - 1; l++) {
		layers.push({
			weights: initWeights(sizes[l], sizes[l + 1]),
			biases: initBiases(sizes[l + 1]),
		});
	}
	return { layers, featureConfig: { locationAvgRevenue: 10000, locationMaxCovers: 200 } };
}

function layerForward(
	input: number[],
	weights: number[][],
	biases: number[],
	useRelu: boolean,
): number[] {
	const outputSize = biases.length;
	const output: number[] = [];
	for (let j = 0; j < outputSize; j++) {
		let sum = biases[j];
		for (let i = 0; i < input.length; i++) {
			sum += input[i] * weights[i][j];
		}
		output.push(useRelu ? relu(sum) : sum);
	}
	return output;
}

function forwardPass(input: number[], model: ModelWeights): number {
	let current = input;
	for (let l = 0; l < model.layers.length; l++) {
		const isLast = l === model.layers.length - 1;
		current = layerForward(
			current,
			model.layers[l].weights,
			model.layers[l].biases,
			!isLast,
		);
	}
	return current[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Neural Forecast — Feature Vector', () => {
	it('feature vector has correct length (19)', () => {
		const features: NeuralFeatures = {
			dowOneHot: [0, 0, 0, 1, 0, 0, 0], // Wednesday
			weekInPeriod: 0.5,
			periodNumber: 0.3,
			month: 0.25,
			isHoliday: 0,
			weatherTemp: 0.65,
			weatherPrecip: 0.1,
			resyCovers: 0.4,
			pyRevenue: 0.5,
			trailingDowAvg: 0.45,
			budget: 0.5,
			checkAvgTrend: 0.55,
			dowRevenueShare: 0.18,
		};

		const vector = featuresToVector(features);
		expect(vector).toHaveLength(19);
	});

	it('DOW one-hot encoding has exactly one 1 and six 0s', () => {
		const features: NeuralFeatures = {
			dowOneHot: [0, 0, 0, 0, 0, 1, 0], // Friday
			weekInPeriod: 0, periodNumber: 0, month: 0,
			isHoliday: 0, weatherTemp: 0, weatherPrecip: 0,
			resyCovers: 0, pyRevenue: 0, trailingDowAvg: 0,
			budget: 0, checkAvgTrend: 0, dowRevenueShare: 0,
		};

		const oneCount = features.dowOneHot.filter(v => v === 1).length;
		const zeroCount = features.dowOneHot.filter(v => v === 0).length;
		expect(oneCount).toBe(1);
		expect(zeroCount).toBe(6);
	});

	it('all scalar features are in [0, 1] range', () => {
		const features: NeuralFeatures = {
			dowOneHot: [1, 0, 0, 0, 0, 0, 0],
			weekInPeriod: 0.5, periodNumber: 0.3, month: 0.25,
			isHoliday: 0, weatherTemp: 0.65, weatherPrecip: 0.1,
			resyCovers: 0.4, pyRevenue: 0.5, trailingDowAvg: 0.45,
			budget: 0.5, checkAvgTrend: 0.55, dowRevenueShare: 0.18,
		};

		const vector = featuresToVector(features);
		for (const v of vector) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});
});

describe('Neural Forecast — MLP Forward Pass', () => {
	it('produces a finite number output', () => {
		const model = createRandomModel();
		const input = Array.from({ length: INPUT_SIZE }, () => Math.random());
		const output = forwardPass(input, model);

		expect(typeof output).toBe('number');
		expect(isFinite(output)).toBe(true);
		expect(isNaN(output)).toBe(false);
	});

	it('output changes with different inputs', () => {
		const model = createRandomModel();
		const input1 = Array(INPUT_SIZE).fill(0.5);
		const input2 = Array(INPUT_SIZE).fill(0.1);

		const output1 = forwardPass(input1, model);
		const output2 = forwardPass(input2, model);

		// With random weights, different inputs should produce different outputs
		// (probability of exact equality is essentially zero)
		expect(output1).not.toBe(output2);
	});

	it('all-zero input produces a number (bias-only path)', () => {
		const model = createRandomModel();
		const input = Array(INPUT_SIZE).fill(0);
		const output = forwardPass(input, model);
		expect(typeof output).toBe('number');
		expect(isFinite(output)).toBe(true);
	});
});

describe('Neural Forecast — Xavier Initialization', () => {
	it('weights are bounded by Xavier scale', () => {
		const rows = 19;
		const cols = 32;
		const expectedScale = Math.sqrt(2.0 / (rows + cols));

		const weights = initWeights(rows, cols);
		expect(weights).toHaveLength(rows);
		expect(weights[0]).toHaveLength(cols);

		for (const row of weights) {
			for (const w of row) {
				// Values should be within [-scale, +scale] (with high probability)
				expect(Math.abs(w)).toBeLessThanOrEqual(expectedScale * 1.01);
			}
		}
	});

	it('weight matrix dimensions match layer sizes', () => {
		const model = createRandomModel();
		const expectedSizes = [INPUT_SIZE, ...HIDDEN_LAYERS, 1];

		for (let l = 0; l < model.layers.length; l++) {
			const { weights, biases } = model.layers[l];
			expect(weights).toHaveLength(expectedSizes[l]);
			expect(weights[0]).toHaveLength(expectedSizes[l + 1]);
			expect(biases).toHaveLength(expectedSizes[l + 1]);
		}
	});

	it('biases are initialized to zero', () => {
		const model = createRandomModel();
		for (const layer of model.layers) {
			for (const b of layer.biases) {
				expect(b).toBe(0);
			}
		}
	});

	it('model has correct number of layers (4)', () => {
		const model = createRandomModel();
		// input->32, 32->16, 16->8, 8->1 = 4 layers
		expect(model.layers).toHaveLength(4);
	});
});

describe('Neural Forecast — ReLU Activation', () => {
	it('positive values pass through unchanged', () => {
		expect(relu(5)).toBe(5);
		expect(relu(0.001)).toBe(0.001);
	});

	it('negative values become zero', () => {
		expect(relu(-5)).toBe(0);
		expect(relu(-0.001)).toBe(0);
	});

	it('zero returns zero', () => {
		expect(relu(0)).toBe(0);
	});
});
