/* @ts-self-types="./ruflo_watermark.d.ts" */

/**
 * Detection result, JS-facing (fields via getters).
 */
class WasmDetection {
    static __wrap(ptr) {
        const obj = Object.create(WasmDetection.prototype);
        obj.__wbg_ptr = ptr;
        WasmDetectionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDetectionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmdetection_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get log10_p() {
        const ret = wasm.wasmdetection_log10_p(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get p_value() {
        const ret = wasm.wasmdetection_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get scored_positions() {
        const ret = wasm.wasmdetection_scored_positions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get z_score() {
        const ret = wasm.wasmdetection_z_score(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmDetection.prototype[Symbol.dispose] = WasmDetection.prototype.free;
exports.WasmDetection = WasmDetection;

/**
 * Streaming watermarked sampler, JS-facing.
 */
class WasmWatermarker {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWatermarkerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwatermarker_free(ptr, 0);
    }
    /**
     * `key_material`: arbitrary secret bytes (e.g. a hex string's bytes).
     * `scheme`: `"tournament"` | `"tournament_nd"` | `"gumbel"` (default gumbel).
     * @param {Uint8Array} key_material
     * @param {number} context_width
     * @param {number} layers
     * @param {string} scheme
     */
    constructor(key_material, context_width, layers, scheme) {
        const ptr0 = passArray8ToWasm0(key_material, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(scheme, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwatermarker_new(ptr0, len0, context_width, layers, ptr1, len1);
        this.__wbg_ptr = ret;
        WasmWatermarkerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Emit one token: returns the index into `tokens`/`probs` of the chosen
     * candidate. Advances the rolling context.
     * @param {Uint32Array} tokens
     * @param {Float32Array} probs
     * @returns {number}
     */
    step(tokens, probs) {
        const ptr0 = passArray32ToWasm0(tokens, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(probs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwatermarker_step(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmWatermarker.prototype[Symbol.dispose] = WasmWatermarker.prototype.free;
exports.WasmWatermarker = WasmWatermarker;

/**
 * Detect a watermark over an emitted token id sequence, using the named scheme.
 * @param {Uint32Array} tokens
 * @param {Uint8Array} key_material
 * @param {number} context_width
 * @param {number} layers
 * @param {string} scheme
 * @returns {WasmDetection}
 */
function detect(tokens, key_material, context_width, layers, scheme) {
    const ptr0 = passArray32ToWasm0(tokens, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key_material, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(scheme, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.detect(ptr0, len0, ptr1, len1, context_width, layers, ptr2, len2);
    return WasmDetection.__wrap(ret);
}
exports.detect = detect;

/**
 * Exact-null short-text detection (Gumbel, exact Gamma tail): correct p-values
 * at small token counts where the normal approximation misleads. See `bayes.rs`.
 * @param {Uint32Array} tokens
 * @param {Uint8Array} key_material
 * @param {number} context_width
 * @returns {WasmDetection}
 */
function detect_exact(tokens, key_material, context_width) {
    const ptr0 = passArray32ToWasm0(tokens, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key_material, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.detect_exact(ptr0, len0, ptr1, len1, context_width);
    return WasmDetection.__wrap(ret);
}
exports.detect_exact = detect_exact;

/**
 * Indel-robust detection (Gumbel self-sync): far stronger than the standard
 * detector on edited / repetitive text. See `align.rs`.
 * @param {Uint32Array} tokens
 * @param {Uint8Array} key_material
 * @param {number} context_width
 * @returns {WasmDetection}
 */
function detect_selfsync(tokens, key_material, context_width) {
    const ptr0 = passArray32ToWasm0(tokens, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(key_material, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.detect_selfsync(ptr0, len0, ptr1, len1, context_width);
    return WasmDetection.__wrap(ret);
}
exports.detect_selfsync = detect_selfsync;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./ruflo_watermark_bg.js": import0,
    };
}

const WasmDetectionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmdetection_free(ptr, 1));
const WasmWatermarkerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwatermarker_free(ptr, 1));

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/ruflo_watermark_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
