import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridgeDirectory = path.dirname(fileURLToPath(import.meta.url));
const bridgeEntrypoint = path.join(bridgeDirectory, "index.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: body ? "POST" : "GET",
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
    }, (res) => {
      let response = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { response += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(response) });
        } catch (error) {
          reject(new Error(`invalid bridge response: ${error.message}`));
        }
      });
    });
    req.once("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(port) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const health = await request(port, "/health");
      if (health.status === 200) return health.body;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw lastError || new Error("bridge did not become healthy");
}

function startBridge(port, environment) {
  const child = spawn(process.execPath, [bridgeEntrypoint], {
    cwd: bridgeDirectory,
    env: { ...process.env, PORT: String(port), MCP_BIND_HOST: "127.0.0.1", MCP_GROUP_INTELLIGENCE: "false", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.on("data", (data) => { diagnostics += data; });
  child.stderr.on("data", (data) => { diagnostics += data; });
  return { child, diagnostics: () => diagnostics };
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function writeFakeNativeChild(directory) {
  const executable = path.join(directory, "fake-native-ruflo.mjs");
  const argumentsFile = path.join(directory, "arguments.json");
  const source = `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
await appendFile(${JSON.stringify(argumentsFile)}, JSON.stringify(process.argv.slice(2)) + "\\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    let result;
    if (request.method === "initialize") result = { protocolVersion: "2024-11-05", serverInfo: { name: "fake-native-ruflo", version: "1" }, capabilities: { tools: {} } };
    else if (request.method === "tools/list") result = { tools: [{ name: "memory_store", description: "fake native store", inputSchema: { type: "object" } }] };
    else if (request.method === "tools/call") result = { content: [{ type: "text", text: JSON.stringify(request.params) }] };
    else result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  }
});
`;
  await writeFile(executable, source, { mode: 0o755 });
  await chmod(executable, 0o755);
  return { executable, argumentsFile };
}

test("bridge launches an opt-in native Ruflo child with fixed arguments and routes namespaced calls", async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ruflo-native-child-"));
  const { executable, argumentsFile } = await writeFakeNativeChild(temporaryDirectory);
  const port = await freePort();
  const bridge = startBridge(port, { RUFLO_MCP_COMMAND: executable, ENABLE_RUFLO: "true" });
  t.after(async () => {
    await stop(bridge.child);
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const health = await waitForHealth(port);
  assert.equal(health.backends.ruflo.ready, true, bridge.diagnostics());
  assert.equal(health.groups.memory.enabled, true);

  const listed = await request(port, "/mcp", { jsonrpc: "2.0", id: "list", method: "tools/list", params: {} });
  assert.ok(listed.body.result.tools.some((tool) => tool.name === "ruflo__memory_store"));

  const called = await request(port, "/mcp", {
    jsonrpc: "2.0",
    id: "call",
    method: "tools/call",
    params: { name: "ruflo__memory_store", arguments: { key: "proof", value: "native" } },
  });
  const backendResult = JSON.parse(called.body.result.content[0].text);
  const forwarded = JSON.parse(backendResult.content[0].text);
  assert.equal(forwarded.name, "memory_store");
  assert.deepEqual(forwarded.arguments, { key: "proof", value: "native" });
  assert.deepEqual(JSON.parse((await readFile(argumentsFile, "utf8")).trim()), ["mcp", "start"]);
});

test("ENABLE_RUFLO=false prevents every Ruflo group and child startup", async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ruflo-native-disabled-"));
  const { executable, argumentsFile } = await writeFakeNativeChild(temporaryDirectory);
  const port = await freePort();
  const bridge = startBridge(port, { RUFLO_MCP_COMMAND: executable, ENABLE_RUFLO: "false" });
  t.after(async () => {
    await stop(bridge.child);
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const health = await waitForHealth(port);
  assert.equal(health.backends.ruflo, undefined);
  assert.equal(health.tools.external, 0);
  for (const group of ["agents", "memory", "devtools", "security", "browser", "neural"]) {
    assert.equal(health.groups[group].enabled, false, `${group} should be disabled`);
  }
  await assert.rejects(readFile(argumentsFile, "utf8"));
});
