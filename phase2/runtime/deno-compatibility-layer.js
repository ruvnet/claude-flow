"use strict";
/**
 * Deno-to-Node.js Compatibility Layer
 *
 * This module provides Node.js equivalents for Deno APIs to enable
 * progressive migration from dual runtime to Node.js only.
 *
 * Phase 2 Runtime Migration - Issues #72, #79
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DenoCompat = exports.DenoCompatErrors = exports.DenoCompatSystem = exports.DenoCompatCommand = exports.DenoCompatEnv = exports.DenoCompatFS = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const child_process_1 = require("child_process");
const util_1 = require("util");
const process_1 = require("process");
const process_2 = require("process");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * File System Operations
 * Mapping Deno file operations to Node.js fs promises
 */
class DenoCompatFS {
    /**
     * Deno.writeTextFile equivalent
     */
    static async writeTextFile(path, data, options) {
        const resolvedPath = (0, path_1.resolve)(path);
        if (options?.create !== false) {
            // Ensure directory exists
            await fs_1.promises.mkdir((0, path_1.join)(resolvedPath, '..'), { recursive: true });
        }
        const writeOptions = { encoding: 'utf8' };
        if (options?.append) {
            writeOptions.flag = 'a';
        }
        await fs_1.promises.writeFile(resolvedPath, data, writeOptions);
    }
    /**
     * Deno.readTextFile equivalent
     */
    static async readTextFile(path) {
        return await fs_1.promises.readFile((0, path_1.resolve)(path), 'utf8');
    }
    /**
     * Deno.stat equivalent
     */
    static async stat(path) {
        const stats = await fs_1.promises.stat((0, path_1.resolve)(path));
        return {
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            isSymlink: stats.isSymbolicLink(),
            size: stats.size,
            mtime: stats.mtime,
            atime: stats.atime,
            birthtime: stats.birthtime,
            mode: stats.mode,
            uid: stats.uid,
            gid: stats.gid
        };
    }
    /**
     * Deno.mkdir equivalent
     */
    static async mkdir(path, options) {
        await fs_1.promises.mkdir((0, path_1.resolve)(path), {
            recursive: options?.recursive ?? false,
            mode: options?.mode
        });
    }
    /**
     * Deno.remove equivalent
     */
    static async remove(path, options) {
        await fs_1.promises.rm((0, path_1.resolve)(path), {
            recursive: options?.recursive ?? false,
            force: true
        });
    }
    /**
     * Deno.readDir equivalent
     */
    static async *readDir(path) {
        const entries = await fs_1.promises.readdir((0, path_1.resolve)(path), { withFileTypes: true });
        for (const entry of entries) {
            yield {
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymlink: entry.isSymbolicLink()
            };
        }
    }
    /**
     * Check if file/directory exists (Deno equivalent)
     */
    static async exists(path) {
        try {
            await fs_1.promises.access((0, path_1.resolve)(path), fs_1.constants.F_OK);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.DenoCompatFS = DenoCompatFS;
/**
 * Environment and Process Operations
 * Mapping Deno environment APIs to Node.js process
 */
class DenoCompatEnv {
    /**
     * Deno.args equivalent
     */
    static get args() {
        return process_1.argv.slice(2);
    }
    /**
     * Deno.cwd equivalent
     */
    static cwd() {
        return (0, process_1.cwd)();
    }
    /**
     * Deno.chdir equivalent
     */
    static chdir(directory) {
        (0, process_1.chdir)(directory);
    }
    /**
     * Deno.exit equivalent
     */
    static exit(code) {
        (0, process_1.exit)(code || 0);
    }
    /**
     * Deno.pid equivalent
     */
    static get pid() {
        return process_1.pid;
    }
    /**
     * Deno.kill equivalent
     */
    static kill(pid, signal) {
        (0, process_1.kill)(pid, signal);
    }
}
exports.DenoCompatEnv = DenoCompatEnv;
/**
 * Deno.env equivalent
 */
DenoCompatEnv.env = {
    get: (key) => process_1.env[key],
    set: (key, value) => { process_1.env[key] = value; },
    delete: (key) => { delete process_1.env[key]; },
    has: (key) => key in process_1.env,
    toObject: () => ({ ...process_1.env })
};
/**
 * Command Execution
 * Mapping Deno.Command to Node.js child_process
 */
class DenoCompatCommand {
    constructor(command, options) {
        this.command = command;
        this.args = options?.args || [];
        this.options = {
            cwd: options?.cwd,
            env: { ...process_1.env, ...(options?.env || {}) },
            stdio: [
                this.mapStdio(options?.stdin || 'inherit'),
                this.mapStdio(options?.stdout || 'inherit'),
                this.mapStdio(options?.stderr || 'inherit')
            ]
        };
    }
    mapStdio(stdio) {
        switch (stdio) {
            case 'piped': return 'pipe';
            case 'inherit': return 'inherit';
            case 'null': return 'ignore';
        }
    }
    /**
     * Execute command and return result
     */
    async output() {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)(this.command, this.args, this.options);
            let stdout = Buffer.alloc(0);
            let stderr = Buffer.alloc(0);
            if (child.stdout) {
                child.stdout.on('data', (data) => {
                    stdout = Buffer.concat([stdout, data]);
                });
            }
            if (child.stderr) {
                child.stderr.on('data', (data) => {
                    stderr = Buffer.concat([stderr, data]);
                });
            }
            child.on('close', (code) => {
                resolve({
                    code: code || 0,
                    stdout: new Uint8Array(stdout),
                    stderr: new Uint8Array(stderr),
                    success: code === 0
                });
            });
            child.on('error', reject);
        });
    }
    /**
     * Spawn command and return child process
     */
    spawn() {
        const child = (0, child_process_1.spawn)(this.command, this.args, this.options);
        return {
            pid: child.pid,
            status: new Promise((resolve) => {
                child.on('close', (code) => {
                    resolve({
                        code: code || 0,
                        success: code === 0
                    });
                });
            })
        };
    }
}
exports.DenoCompatCommand = DenoCompatCommand;
/**
 * System Information
 * Mapping Deno system APIs to Node.js equivalents
 */
class DenoCompatSystem {
    /**
     * Deno.memoryUsage equivalent
     */
    static memoryUsage() {
        const usage = (0, process_1.memoryUsage)();
        return {
            rss: usage.rss,
            heapTotal: usage.heapTotal,
            heapUsed: usage.heapUsed,
            external: usage.external
        };
    }
    /**
     * Deno.build equivalent
     */
    static get build() {
        return {
            target: `${process_1.arch}-${process_1.platform}`,
            arch: process_1.arch,
            os: process_1.platform,
            vendor: 'nodejs',
            env: 'node'
        };
    }
    /**
     * Deno.stdin equivalent
     */
    static get stdin() {
        return process_2.stdin;
    }
    /**
     * Deno.stdout equivalent
     */
    static get stdout() {
        return process_2.stdout;
    }
    /**
     * Deno.addSignalListener equivalent
     */
    static addSignalListener(signal, handler) {
        process.on(signal, handler);
    }
    /**
     * Remove signal listener (Node.js equivalent)
     */
    static removeSignalListener(signal, handler) {
        process.off(signal, handler);
    }
}
exports.DenoCompatSystem = DenoCompatSystem;
/**
 * Error Types
 * Mapping Deno.errors to Node.js equivalents
 */
class DenoCompatErrors {
}
exports.DenoCompatErrors = DenoCompatErrors;
DenoCompatErrors.NotFound = class extends Error {
    constructor(message) {
        super(message || 'File or directory not found');
        this.name = 'NotFound';
    }
};
DenoCompatErrors.PermissionDenied = class extends Error {
    constructor(message) {
        super(message || 'Permission denied');
        this.name = 'PermissionDenied';
    }
};
DenoCompatErrors.AlreadyExists = class extends Error {
    constructor(message) {
        super(message || 'File or directory already exists');
        this.name = 'AlreadyExists';
    }
};
/**
 * Main Compatibility Object
 * Drop-in replacement for Deno global
 */
exports.DenoCompat = {
    writeTextFile: DenoCompatFS.writeTextFile,
    readTextFile: DenoCompatFS.readTextFile,
    stat: DenoCompatFS.stat,
    mkdir: DenoCompatFS.mkdir,
    remove: DenoCompatFS.remove,
    readDir: DenoCompatFS.readDir,
    exists: DenoCompatFS.exists,
    env: DenoCompatEnv.env,
    args: DenoCompatEnv.args,
    cwd: DenoCompatEnv.cwd,
    chdir: DenoCompatEnv.chdir,
    exit: DenoCompatEnv.exit,
    pid: DenoCompatEnv.pid,
    kill: DenoCompatEnv.kill,
    Command: DenoCompatCommand,
    memoryUsage: DenoCompatSystem.memoryUsage,
    build: DenoCompatSystem.build,
    stdin: DenoCompatSystem.stdin,
    stdout: DenoCompatSystem.stdout,
    addSignalListener: DenoCompatSystem.addSignalListener,
    removeSignalListener: DenoCompatSystem.removeSignalListener,
    errors: DenoCompatErrors
};
/**
 * Global Deno polyfill
 * Can be used to replace Deno global during migration
 */
if (typeof globalThis !== 'undefined' && !globalThis.Deno) {
    globalThis.Deno = exports.DenoCompat;
}
exports.default = exports.DenoCompat;
