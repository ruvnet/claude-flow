/**
 * Neural Time-Series Forecast — pure TypeScript MLP regression.
 *
 * Architecture: Multi-Layer Perceptron [input -> 32 -> 16 -> 8 -> 1]
 * with ReLU activations and simple SGD training.
 * Runs on Vercel serverless (no GPU/Python dependencies).
 *
 * Data loading and feature engineering are in neural-data.ts.
 * Weights stored in Supabase `neural_model_weights` as JSON.
 */

import { getSupabase, getSupabaseService } from '$lib/server/supabase';
import { loadTrainingData, featuresToVector } from './neural-data';

// ---------------------------------------------------------------------------
// Types (exported for use by neural-data.ts and ensemble.ts)
// ---------------------------------------------------------------------------

export interface NeuralFeatures {
	dowOneHot: number[];       // 7 values (0 or 1)
	weekInPeriod: number;      // normalized 0-1
	periodNumber: number;      // normalized 0-1
	month: number;             // normalized 0-1
	isHoliday: number;         // 0 or 1
	weatherTemp: number;       // normalized 0-1
	weatherPrecip: number;     // 0-1
	resyCovers: number;        // normalized by location max
	pyRevenue: number;         // normalized by location avg
	trailingDowAvg: number;    // normalized by location avg
	budget: number;            // normalized by location avg
	checkAvgTrend: number;     // pct change clamped -0.5..0.5 -> 0..1
	dowRevenueShare: number;   // 0-1 (% of weekly total)
}

export interface ModelWeights {
	layers: { weights: number[][]; biases: number[] }[];
	featureConfig: {
		locationAvgRevenue: number;
		locationMaxCovers: number;
	};
}

export interface NeuralPrediction {
	revenue: number;
	confidence: number;
	modelVersion: string;
	trainingSamples: number;
	trainingMape: number;
}

const INPUT_SIZE = 19; // 7 DOW + 12 scalar features
const HIDDEN_LAYERS = [32, 16, 8];
const LEARNING_RATE = 0.001;
const EPOCHS = 200;
const BATCH_SIZE = 32;
const MODEL_VERSION = 'mlp-v1';

// ---------------------------------------------------------------------------
// Activation helpers
// ---------------------------------------------------------------------------

function relu(x: number): number {
	return x > 0 ? x : 0;
}

function reluDerivative(x: number): number {
	return x > 0 ? 1 : 0;
}

/** Xavier initialization for a weight matrix. */
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

// ---------------------------------------------------------------------------
// Forward pass
// ---------------------------------------------------------------------------

function layerForward(
	input: number[],
	weights: number[][],
	biases: number[],
	useRelu: boolean,
): { output: number[]; preActivation: number[] } {
	const outputSize = biases.length;
	const preActivation: number[] = new Array(outputSize).fill(0);

	for (let j = 0; j < outputSize; j++) {
		let sum = biases[j];
		for (let i = 0; i < input.length; i++) {
			sum += input[i] * weights[i][j];
		}
		preActivation[j] = sum;
	}

	const output = useRelu
		? preActivation.map(relu)
		: [...preActivation];

	return { output, preActivation };
}

interface ForwardResult {
	layerOutputs: number[][];
	layerPreActivations: number[][];
	prediction: number;
}

function forwardPass(input: number[], model: ModelWeights): ForwardResult {
	const layerOutputs: number[][] = [input];
	const layerPreActivations: number[][] = [];
	let current = input;

	for (let l = 0; l < model.layers.length; l++) {
		const isLast = l === model.layers.length - 1;
		const { output, preActivation } = layerForward(
			current,
			model.layers[l].weights,
			model.layers[l].biases,
			!isLast,
		);
		layerPreActivations.push(preActivation);
		layerOutputs.push(output);
		current = output;
	}

	return { layerOutputs, layerPreActivations, prediction: current[0] };
}

// ---------------------------------------------------------------------------
// Backpropagation
// ---------------------------------------------------------------------------

function backpropAndUpdate(
	model: ModelWeights,
	fwdResult: ForwardResult,
	target: number,
	lr: number,
): number {
	const { layerOutputs, layerPreActivations } = fwdResult;
	const numLayers = model.layers.length;
	const error = fwdResult.prediction - target;
	const loss = 0.5 * error * error;

	let delta: number[] = [error];

	for (let l = numLayers - 1; l >= 0; l--) {
		const layerInput = layerOutputs[l];
		const { weights, biases } = model.layers[l];
		const outputSize = biases.length;
		const inputSize = layerInput.length;

		if (l < numLayers - 1) {
			for (let j = 0; j < outputSize; j++) {
				delta[j] *= reluDerivative(layerPreActivations[l][j]);
			}
		}

		let prevDelta: number[] | null = null;
		if (l > 0) {
			prevDelta = new Array(inputSize).fill(0);
			for (let i = 0; i < inputSize; i++) {
				for (let j = 0; j < outputSize; j++) {
					prevDelta[i] += delta[j] * weights[i][j];
				}
			}
		}

		for (let i = 0; i < inputSize; i++) {
			for (let j = 0; j < outputSize; j++) {
				weights[i][j] -= lr * delta[j] * layerInput[i];
			}
		}
		for (let j = 0; j < outputSize; j++) {
			biases[j] -= lr * delta[j];
		}

		if (prevDelta) delta = prevDelta;
	}

	return loss;
}

// ---------------------------------------------------------------------------
// Model initialization
// ---------------------------------------------------------------------------

function createRandomModel(): ModelWeights {
	const sizes = [INPUT_SIZE, ...HIDDEN_LAYERS, 1];
	const layers: { weights: number[][]; biases: number[] }[] = [];

	for (let l = 0; l < sizes.length - 1; l++) {
		layers.push({
			weights: initWeights(sizes[l], sizes[l + 1]),
			biases: initBiases(sizes[l + 1]),
		});
	}

	return {
		layers,
		featureConfig: { locationAvgRevenue: 0, locationMaxCovers: 0 },
	};
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export async function trainModel(
	locationId: string,
): Promise<{ success: boolean; samples: number; mape: number; message: string }> {
	const { samples, avgRevenue, maxCovers } = await loadTrainingData(locationId);

	if (samples.length < 30) {
		return { success: false, samples: samples.length, mape: 100, message: 'Insufficient data (need 30+ days)' };
	}

	const model = createRandomModel();
	model.featureConfig.locationAvgRevenue = avgRevenue;
	model.featureConfig.locationMaxCovers = maxCovers;

	const splitIdx = Math.floor(samples.length * 0.85);
	const trainSet = samples.slice(0, splitIdx);
	const valSet = samples.slice(splitIdx);

	let bestValLoss = Infinity;
	let bestWeightsJson = '';
	const patience = 20;
	let noImprove = 0;

	for (let epoch = 0; epoch < EPOCHS; epoch++) {
		// Shuffle
		for (let i = trainSet.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[trainSet[i], trainSet[j]] = [trainSet[j], trainSet[i]];
		}

		// Mini-batch SGD
		for (let b = 0; b < trainSet.length; b += BATCH_SIZE) {
			const batchEnd = Math.min(b + BATCH_SIZE, trainSet.length);
			for (let s = b; s < batchEnd; s++) {
				const fwd = forwardPass(trainSet[s].features, model);
				backpropAndUpdate(model, fwd, trainSet[s].target, LEARNING_RATE);
			}
		}

		// Validation
		let valLoss = 0;
		for (const sample of valSet) {
			const pred = forwardPass(sample.features, model).prediction;
			valLoss += (pred - sample.target) ** 2;
		}
		valLoss /= valSet.length || 1;

		if (valLoss < bestValLoss) {
			bestValLoss = valLoss;
			bestWeightsJson = JSON.stringify(model.layers);
			noImprove = 0;
		} else {
			noImprove++;
			if (noImprove >= patience) break;
		}
	}

	if (bestWeightsJson) model.layers = JSON.parse(bestWeightsJson);

	// Compute MAPE on validation set
	let totalApe = 0;
	for (const sample of valSet) {
		const pred = forwardPass(sample.features, model).prediction;
		const denormPred = pred * avgRevenue * 2;
		const denormActual = sample.target * avgRevenue * 2;
		if (denormActual > 0) {
			totalApe += Math.abs(denormPred - denormActual) / denormActual;
		}
	}
	const mape = valSet.length > 0 ? (totalApe / valSet.length) * 100 : 100;

	// Persist to Supabase
	const sb = getSupabaseService();
	await sb.from('neural_model_weights').upsert({
		location_id: locationId,
		model_version: MODEL_VERSION,
		weights_json: model.layers,
		feature_config_json: model.featureConfig,
		training_samples: samples.length,
		training_mape: Math.round(mape * 100) / 100,
		trained_at: new Date().toISOString(),
	}, { onConflict: 'location_id,model_version' });

	return {
		success: true,
		samples: samples.length,
		mape: Math.round(mape * 100) / 100,
		message: `Trained on ${samples.length} samples, val MAPE ${mape.toFixed(1)}%`,
	};
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

export async function loadModel(locationId: string): Promise<ModelWeights | null> {
	const sb = getSupabase();
	const { data } = await sb
		.from('neural_model_weights')
		.select('weights_json, feature_config_json')
		.eq('location_id', locationId)
		.eq('model_version', MODEL_VERSION)
		.maybeSingle();

	if (!data?.weights_json) return null;

	return {
		layers: data.weights_json as ModelWeights['layers'],
		featureConfig: data.feature_config_json as ModelWeights['featureConfig'],
	};
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export async function predict(
	locationId: string,
	features: NeuralFeatures,
): Promise<NeuralPrediction | null> {
	const model = await loadModel(locationId);
	if (!model) return null;

	const input = featuresToVector(features);
	const { prediction } = forwardPass(input, model);

	const avgRev = model.featureConfig.locationAvgRevenue;
	const revenue = Math.max(0, prediction * avgRev * 2);

	const sb = getSupabase();
	const { data: meta } = await sb
		.from('neural_model_weights')
		.select('training_samples, training_mape')
		.eq('location_id', locationId)
		.eq('model_version', MODEL_VERSION)
		.maybeSingle();

	return {
		revenue: Math.round(revenue * 100) / 100,
		confidence: meta?.training_mape ? Math.max(0.1, 1 - meta.training_mape / 100) : 0.3,
		modelVersion: MODEL_VERSION,
		trainingSamples: meta?.training_samples || 0,
		trainingMape: meta?.training_mape || 100,
	};
}

// ---------------------------------------------------------------------------
// Public feature builder (wraps neural-data.ts with loadModel injected)
// ---------------------------------------------------------------------------

import { buildFeaturesForDate as _buildFeatures } from './neural-data';

export async function buildFeaturesForDate(
	locationId: string,
	targetDate: string,
): Promise<NeuralFeatures> {
	return _buildFeatures(locationId, targetDate, loadModel);
}
