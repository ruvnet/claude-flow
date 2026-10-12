<div align="center">

[![Ruflo Banner](ruflo/assets/ruflo-small.jpeg)](https://cognitum.one/agentic-engineering)

<!-- Try Ruflo — the 3 badges first-time visitors actually act on -->
[![npm version (ruflo)](https://img.shields.io/npm/v/ruflo?label=npx%20ruflo&style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/ruflo)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Star on GitHub](https://img.shields.io/github/stars/ruvnet/claude-flow?style=for-the-badge&logo=github&color=gold)](https://github.com/ruvnet/claude-flow)

<!-- Ecosystem strip (collapsed visually with flat-square) -->
[![🕸️ RuVector Agentic DB](https://img.shields.io/badge/RuVector_Agentic-DB-06b6d4?style=flat-square&logoColor=white&logo=graphql)](https://github.com/ruvnet/ruvector)
[![Ecosystem downloads](https://img.shields.io/badge/ecosystem%20downloads-8.1M%2B-blue?style=flat-square&logo=npm)](https://github.com/ruvnet/ruflo/blob/main/data/clone-data.proof.json)
[![Git clones (14d)](https://img.shields.io/badge/git%20clones%2014d-106k-blueviolet?style=flat-square&logo=github)](https://github.com/ruvnet/ruflo/blob/main/data/clone-data.ledger.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-D97757?style=flat-square&logoColor=white&logo=anthropic)](https://github.com/ruvnet/claude-flow)
[![Codex Plugin](https://img.shields.io/badge/Codex-Plugin-412991?style=flat-square&logoColor=white&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0yMi4yODIgOS44MjFhNS45ODUgNS45ODUgMCAwIDAtLjUxNi00LjkxIDYuMDQ2IDYuMDQ2IDAgMCAwLTYuNTEtMi45QTYuMDY1IDYuMDY1IDAgMCAwIDQuOTgxIDQuMThhNS45ODUgNS45ODUgMCAwIDAtMy45OTggMi45IDYuMDQ2IDYuMDQ2IDAgMCAwIC43NDMgNy4wOTcgNS45OCA1Ljk4IDAgMCAwIC41MSA0LjkxMSA2LjA1MSA2LjA1MSAwIDAgMCA2LjUxNSAyLjlBNS45ODUgNS45ODUgMCAwIDAgMTMuMjYgMjRhNi4wNTYgNi4wNTYgMCAwIDAgNS43NzItNC4yMDYgNS45OSA1Ljk5IDAgMCAwIDMuOTk4LTIuOSA2LjA1NiA2LjA1NiAwIDAgMC0uNzQ3LTcuMDczek0xMy4yNiAyMi40M2E0LjQ3NiA0LjQ3NiAwIDAgMS0yLjg3Ni0xLjA0bC4xNDItLjA4IDQuNzc4LTIuNzU4YS43OTUuNzk1IDAgMCAwIC4zOTMtLjY4MXYtNi43MzdsMi4wMiAxLjE2OGEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4M2E0LjUwNCA0LjUwNCAwIDAgMS00LjQ5NSA0LjQ5NHpNMy42IDE4LjMwNGE0LjQ3IDQuNDcgMCAwIDEtLjUzNS0zLjAxNGwuMTQyLjA4NSA0Ljc4MyAyLjc1OWEuNzcxLjc3MSAwIDAgMCAuNzgxIDBsNS44NDMtMy4zNjl2Mi4zMzJhLjA4LjA4IDAgMCAxLS4wMzMuMDYyTDkuNzQgMTkuOTVhNC41IDQuNSAwIDAgMS02LjE0LTEuNjQ2ek0yLjM0IDcuODk2YTQuNDg1IDQuNDg1IDAgMCAxIDIuMzY2LTEuOTczVjExLjZhLjc2Ni43NjYgMCAwIDAgLjM4OC42NzdsNS44MTUgMy4zNTQtMi4wMiAxLjE2OGEuMDc2LjA3NiAwIDAgMS0uMDcyIDBsLTQuODMtMi43ODZBNC41MDQgNC41MDQgMCAwIDEgMi4zNCA3Ljg3MnptMTYuNTk3IDMuODU1LTUuODMzLTMuMzg3IDIuMDE2LTEuMTY1YS4wNzYuMDc2IDAgMCAxIC4wNzEgMGw0LjgzIDIuNzkxYTQuNDk0IDQuNDk0IDAgMCAxLS42NzYgOC4xMDR2LTUuNjc3YS43OS43OSAwIDAgMC0uNDA3LS42Njd6bTIuMDEtMy4wMjMtLjE0MS0uMDg1LTQuNzc0LTIuNzgyYS43NzYuNzc2IDAgMCAwLS43ODUgMEw5LjQwOSA5LjIzVjYuODk3YS4wNjYuMDY2IDAgMCAxIC4wMjgtLjA2Mmw0LjgzLTIuNzg3YTQuNDk5IDQuNDk5IDAgMCAxIDYuNjggNC42NnpNOC4zMDcgMTIuODYzbC0yLjAyLTEuMTY0YS4wOC4wOCAwIDAgMS0uMDM4LS4wNTdWNi4wNzRhNC40OTkgNC40OTkgMCAwIDEgNy4zNzYtMy40NTRsLS4xNDIuMDgtNC43NzggMi43NThhLjc5NS43OTUgMCAwIDAtLjM5My42ODJ6bTEuMDk3LTIuMzY2IDIuNjAyLTEuNSAyLjYwNyAxLjV2Mi45OTlsLTIuNTk3IDEuNS0yLjYwNy0xLjVaIi8%2BPC9zdmc%2B)](https://www.npmjs.com/package/@claude-flow/codex)

# Ruflo

[English](README.md) · [简体中文](README.zh-CN.md)

**面向 Claude Code 与 Codex 的智能体元基座（meta-harness）。**

[![RuFlo Explained — build an AI team that plans, remembers, tests, and improves](docs/assets/ruflo-explained/ch14.jpg)](docs/ruflo-explained.md)

**[📖 RuFlo 详解——组建一支会规划、会记忆、会测试、会自我改进的 AI 团队](docs/ruflo-explained.md)**
一份 14 章的指南：从基本理念到第一个实用任务，再到记忆、智能体团队、插件、成本与验证。

</div>

> **智能体 = 模型 + 基座（Harness）。** 模型负责写作；基座为它提供工具、记忆、循环、沙箱与控制能力，让模型真正能干成事。**Ruflo 就是那个基座**——围绕 Claude Code 与 Codex 的执行层，它带来 100+ 专用智能体、协同蜂群、自学习记忆、跨机器联邦通信以及企业级安全护栏。智能体不再只是"跑起来"，而是彼此协作。

一行 `npx ruflo init` 就能为 Claude Code 装上神经系统：智能体自行组织成蜂群，从每项任务中学习，跨会话保持记忆，并且——借助联邦能力——能在不泄露数据的前提下与其他机器上的智能体安全通信。你只管继续写代码，协调工作交给 Ruflo。

```
Self-Learning / Self-Optimizing Agent Architecture

User --> Ruflo (CLI/MCP) --> Router --> Swarm --> Agents --> Memory --> LLM Providers
                          ^                           |
                          +---- Learning Loop <-------+
```

> **第一次用 Ruflo？** 你不需要先学会 314 个 MCP 工具或 26 条 CLI 命令。执行完 `init` 之后，像平常一样使用 Claude Code 即可——钩子系统会自动路由任务、从成功模式中学习，并在后台协调智能体。

<details>
<summary><strong>📖 背景——名字的由来</strong></summary>

> Claude Flow 现已更名为 Ruflo——名字来自 [`rUv`](https://ruv.io)，他热爱 Rust、心流状态，以及构建那些让人觉得"本该如此"的东西。"Ru" 来自 rUv，"flo" 是工作到凌晨三点的心流。底层由 [`Cognitum.One`](https://cognitum.one/?RuFlo) 的智能体架构驱动，运行着超强性能的 Rust AI 引擎、嵌入向量、记忆与插件系统。

</details>

---

![Ruflo Plugins](./ruflo-plugins.gif)

## 快速开始

有**两条完全不同的安装路径**，覆盖范围差异很大。请根据你的需要选择（#1744）：

| | **Claude Code 插件** | **CLI 安装（`npx ruflo init`）** |
|---|---|---|
| 提供什么 | 斜杠命令 + 少量技能 + 每个插件各自的智能体定义 | 完整的 Ruflo 循环——98 个智能体、60+ 条命令、30 项技能、MCP 服务器、钩子、守护进程 |
| 工作区中的文件 | **零** | `.claude/`、`.claude-flow/`、`CLAUDE.md`、辅助文件、设置 |
| 是否注册 MCP 服务器 | 仅在安装了 `ruflo-core` 时（它自带 `.mcp.json`）——其他插件大多不会 | 是 |
| 是否安装钩子 | 否 | 是 |
| 适合场景 | 不全面安装，先试用单个插件的命令 | 生产环境使用——一切如文档所述般工作 |

### 路径 A——Claude Code 插件（轻量版，仅斜杠命令）

```bash
# Add the marketplace
/plugin marketplace add ruvnet/ruflo

# Install core + any plugins you need
/plugin install ruflo-core@ruflo
/plugin install ruflo-swarm@ruflo
/plugin install ruflo-rag-memory@ruflo
/plugin install ruflo-neural-trader@ruflo
```

这会添加斜杠命令与智能体定义。上面安装的 `ruflo-core` 确实会在安装时注册它自己的 MCP 服务器——其工具以 `mcp__plugin_ruflo-core_ruflo__*` 形式调用（例如 `mcp__plugin_ruflo-core_ruflo__memory_store`），而不是 CLI 路线脚手架中使用的裸名 `memory_store`/`swarm_init`/`agent_spawn`。其他插件通常不自带 MCP 服务器。想要带 CLI 路线工具名的完整循环，请使用下方的路径 B。

<details>
<summary><strong>🔌 全部 35 个插件</strong></summary>

#### 核心与编排

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-core**](plugins/ruflo-core/README.md) | 基础层——服务器、健康检查、插件发现 |
| [**ruflo-swarm**](plugins/ruflo-swarm/README.md) | 将多个智能体作为团队进行协调 |
| [**ruflo-autopilot**](plugins/ruflo-autopilot/README.md) | 让智能体在循环中自主运行 |
| [**ruflo-loop-workers**](plugins/ruflo-loop-workers/README.md) | 按定时器调度后台任务 |
| [**ruflo-workflows**](plugins/ruflo-workflows/README.md) | 可复用的多步骤任务模板 |
| [**ruflo-federation**](plugins/ruflo-federation/README.md) | 让不同机器上的智能体安全协作 |

#### 记忆与知识

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-agentdb**](plugins/ruflo-agentdb/README.md) | 面向智能体记忆的快速向量数据库 |
| [**ruflo-rag-memory**](plugins/ruflo-rag-memory/README.md) | 智能检索——混合搜索、图谱跳转、多样性排序 |
| [**ruflo-rvf**](plugins/ruflo-rvf/README.md) | 跨会话保存与恢复智能体记忆 |
| [**ruflo-ruvector**](plugins/ruflo-ruvector/README.md) | [`ruvector`](https://npmjs.com/package/ruvector)——GPU 加速搜索、Graph RAG、103 个工具 |
| [**ruflo-knowledge-graph**](plugins/ruflo-knowledge-graph/README.md) | 构建并遍历实体关系图谱 |

#### 智能与学习

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-intelligence**](plugins/ruflo-intelligence/README.md) | 智能体从过往成功中学习，变得越来越聪明 |
| [**ruflo-graph-intelligence**](plugins/ruflo-graph-intelligence/) | 亚线性图推理——PageRank、增量更新、复杂度感知执行（ADR-123） |
| [**ruflo-daa**](plugins/ruflo-daa/README.md) | 动态智能体行为与认知模式 |
| [**ruflo-ruvllm**](plugins/ruflo-ruvllm/README.md) | 通过智能路由运行本地 LLM（Ollama 等） |
| [**ruflo-goals**](plugins/ruflo-goals/README.md) | 将大目标拆解为计划并跟踪进度 |

#### 代码质量与测试

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-testgen**](plugins/ruflo-testgen/README.md) | 找出缺失的测试并自动生成 |
| [**ruflo-browser**](plugins/ruflo-browser/README.md) | 使用 Playwright 自动化浏览器测试 |
| [**ruflo-jujutsu**](plugins/ruflo-jujutsu/README.md) | 分析 git diff、评估风险、推荐审查人 |
| [**ruflo-docs**](plugins/ruflo-docs/README.md) | 自动生成与维护文档 |

#### 安全与合规

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-security-audit**](plugins/ruflo-security-audit/README.md) | 扫描漏洞与 CVE |
| [**ruflo-aidefence**](plugins/ruflo-aidefence/README.md) | 拦截提示词注入、检测 PII、安全扫描 |

#### 架构与方法论

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-adr**](plugins/ruflo-adr/README.md) | 用持续更新的记录跟踪架构决策 |
| [**ruflo-ddd**](plugins/ruflo-ddd/README.md) | 脚手架式搭建领域驱动设计——上下文、聚合、事件 |
| [**ruflo-sparc**](plugins/ruflo-sparc/README.md) | 带质量门的 5 阶段引导式开发方法论 |
| [**ruflo-metaharness**](plugins/ruflo-metaharness/README.md) | 为你的智能体配置打分、扫描工具配置中的安全风险、跟踪长期变更（[指南](docs/metaharness-user-guide.md)） |
| [**ruflo-arena**](plugins/ruflo-arena/README.md) | 竞争性 ruliology——在锦标赛中让智能体策略相互对决，对胜者进行爬山优化与共同进化（ADR-147/148） |

#### DevOps 与可观测性

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-migrations**](plugins/ruflo-migrations/README.md) | 安全地管理数据库 schema 变更 |
| [**ruflo-observability**](plugins/ruflo-observability/README.md) | 一站式结构化日志、追踪与指标 |
| [**ruflo-cost-tracker**](plugins/ruflo-cost-tracker/README.md) | 跟踪 token 用量、设定预算、获取成本告警 |

#### 可扩展性

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-agent**](plugins/ruflo-agent/README.md) | 运行智能体——本地 WASM 沙箱（rvagent）+ Anthropic Claude 托管智能体（云端） |
| [**ruflo-plugin-creator**](plugins/ruflo-plugin-creator/README.md) | 脚手架式创建、校验并发布你自己的插件 |

#### 领域专用

| 插件 | 功能说明 |
|--------|-------------|
| [**ruflo-iot-cognitum**](plugins/ruflo-iot-cognitum/README.md) | IoT 设备管理——信任评分、异常检测、设备群 |
| [**ruflo-neural-trader**](plugins/ruflo-neural-trader/README.md) | [`neural-trader`](https://npmjs.com/package/neural-trader)——AI 交易，含 4 个智能体、回测、112+ 工具 |
| [**ruflo-market-data**](plugins/ruflo-market-data/README.md) | 摄入市场数据、向量化 OHLCV、检测形态 |

</details>

### CLI 安装

**macOS / Linux / WSL / Git-Bash：**

```bash
# One-line install (POSIX shells only — see Windows note below)
curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/ruflo@main/scripts/install.sh | bash
```

**所有平台（包括原生 Windows PowerShell / cmd）：**

```bash
# Interactive setup wizard — runs identically on every platform
npx ruflo@latest init wizard

# Quick non-interactive init
# npx ruflo@latest init

# Or install globally
npm install -g ruflo@latest
```

> 💡 **Windows 用户请注意：** `curl ... | bash` 这种形式需要 POSIX shell（Git-Bash、WSL、MSYS）。`npx ruflo@latest init wizard` 这一行可以在 PowerShell 与 cmd 中原生运行。如果你遇到 `'bash' is not recognized` 报错，改用 `npx` 那一行即可——两条路径最终执行的都是同一个 init 流程。

### MCP 服务器

```bash
# Add Ruflo as an MCP server in Claude Code
claude mcp add claude-flow -- npx ruflo@latest mcp start
```

---

## 你能获得什么

| 能力 | 说明 |
|------------|-------------|
| 🤖 **100+ 智能体** | 面向编码、测试、安全、文档、架构的专用智能体 |
| 📡 **通信层** | 零信任联邦——跨机器/组织的智能体能够安全地相互发现、认证并交换工作 |
| 🐝 **蜂群协调** | 具备共识机制的层级、网状与自适应拓扑 |
| 🧠 **自学习** | SONA 神经模式、ReasoningBank、轨迹学习 |
| 💾 **向量记忆** | 基于 HNSW 索引的 AgentDB——实测在 N=20k 时比暴力检索快约 1.9 倍，N=5k 时快约 3.2–4.7 倍（recall@10 ≈ 0.99）；超过交叉点后 ANN 胜出，小规模 N 下持平或略逊。参见[审计报告](docs/reviews/intelligence-system-audit-2026-05-29.md)与 [`scripts/benchmark-intelligence.mjs`](scripts/benchmark-intelligence.mjs) |
| ⚡ **后台工作者** | 12 个自动触发的工作者（审计、优化、测试缺口等） |
| 🧩 **插件市场** | 33 个原生 Claude Code 插件 + 21 个 npm 插件 |
| 🔌 **多提供商** | Claude、GPT、Gemini、Cohere、Ollama，支持智能路由 |
| 🛡️ **安全性** | AIDefence、输入校验、CVE 修复、路径穿越防护 |
| 🌐 **智能体联邦** | 跨安装的智能体协作，零信任安全 |
| 🔬 **[MetaHarness](docs/metaharness-user-guide.md)** | 发布前审计你的 AI 智能体配置。对就绪度打分（1–100）、扫描工具配置中的安全问题、对整个项目做快照以捕捉长期回归，并找到与你的仓库匹配的模板。`ruflo eject` 可将 ruflo 项目转换为拥有独立名称的独立智能体工具包。[完整指南](docs/metaharness-user-guide.md)。 |

### 智能体联邦——智能体版的 Slack

```
Your Agent --> [ Remove secrets ] --> [ Sign message ] --> [ Encrypted channel ]
                 Emails, SSNs,        Proves it came       No one reads it
                 keys stripped         from you              in transit
                                                                |
                                                                v
Their Agent <-- [ Block attacks ] <-- [ Check identity ] <------+
                 Stops prompt          Rejects forgeries
                 injection

                          Audit trail on both sides.
                  Trust builds over time. Bad behavior = instant downgrade.
```

Slack 给团队带来了频道，联邦则给智能体带来了同样的东西——**跨越信任边界的共享工作区**：不同机器、组织或云区域上的智能体可以相互发现、证明自己的身份，并协作完成任务。

区别在于：有些频道可信，有些不可信。[`@claude-flow/plugin-agent-federation`](https://github.com/ruvnet/ruflo/issues/1669) 会自动处理这一切。你的智能体加入联邦，通过 mTLS + ed25519 完成验证，然后开始交换工作——任何数据离开你的节点前都会先剥离 PII，每条消息都可审计。不可信的智能体仍能以较低权限参与：它们只能看到发现信息，看不到你的记忆。随着它们不断证明自己的可靠性，信任级别会逐步提升；一旦行为失当，立刻降级——全程无需人工介入。

你不需要配置握手流程，也不需要管理证书。执行 `federation init`、`federation join`，你的智能体就会开始对话。协议负责身份验证，PII 流水线负责数据安全，审计追踪负责合规。

> **📘 完整用户指南：** [`docs/federation/`](./docs/federation/)——安装配置、MCP 工具、信任级别、熔断器，以及（可选的）WireGuard 网状层——它把包层的可达性绑定到联邦信任之上。ADR-111 深入解析见 [`docs/federation/phase7-mesh-bringup.md`](./docs/federation/phase7-mesh-bringup.md)。

<details>
<summary><strong>联邦能力</strong></summary>

| | 能力 | 工作原理 |
|---|---|---|
| 🔒 | **零信任联邦** | 远程智能体初始均不受信任。身份通过 mTLS + ed25519 质询-应答机制证明。无需 API Key，无需共享密钥。 |
| 🛡️ | **PII 门控数据流** | 14 类检测流水线扫描每条出站消息。按信任级别执行策略：BLOCK（阻断）、REDACT（脱敏）、HASH（哈希）或 PASS（放行）。自适应校准减少误报。 |
| 📊 | **行为信任评分** | 公式（`0.4×success + 0.2×uptime + 0.2×threat + 0.2×integrity`）持续评估对等方。升级需要历史积累；降级即时生效。 |
| 📋 | **内置合规** | HIPAA、SOC2、GDPR 审计追踪作为合规模式。每个联邦事件都会生成一条可通过 HNSW 检索的结构化记录。 |
| 🤝 | **9 个 MCP 工具 + 10 条 CLI 命令** | 全生命周期：`federation_init`、`federation_send`、`federation_trust`、`federation_audit` 等。 |

</details>

<details>
<summary><strong>示例：两个团队共享欺诈信号，但不共享客户数据</strong></summary>

```bash
# Team A: initialize federation and generate keypair
npx claude-flow@latest federation init

# Team A: join Team B's federation endpoint
npx claude-flow@latest federation join wss://team-b.example.com:8443

# Team A: send a task — PII is stripped automatically before it leaves
npx claude-flow@latest federation send --to team-b --type task-request \
  --message "Analyze transaction patterns for account anomalies"

# Team A: check peer trust levels and session health
npx claude-flow@latest federation status
```

</details>

完整架构、信任模型与实现路线图见 [issue #1669](https://github.com/ruvnet/ruflo/issues/1669)。

```bash
# Claude Code plugin
/plugin install ruflo-federation@ruflo

# Or via CLI
npx claude-flow@latest plugins install @claude-flow/plugin-agent-federation
```

<details>
<summary><strong>Claude Code：有 Ruflo 与没有 Ruflo</strong></summary>

| 能力 | 仅用 Claude Code | 加上 Ruflo |
|------------|-------------------|---------|
| 智能体协作 | 相互隔离，无共享上下文 | 拥有共享记忆与共识的蜂群 |
| 协调机制 | 手动编排 | 蜂后主导的层级架构（Raft、拜占庭、Gossip） |
| 记忆 | 仅限会话内 | 亚毫秒级检索的 HNSW 向量记忆 |
| 学习能力 | 行为固定 | 基于模式匹配的 SONA 自学习 |
| 任务路由 | 由你决定 | 智能路由（准确率 89%） |
| 后台工作者 | 无 | 12 个自动触发的工作者 |
| LLM 提供商 | 仅 Anthropic | 5 家提供商，支持故障转移 |
| 安全性 | 标准水平 | 经 CVE 加固 + AIDefence 防护 |

</details>

<details>
<summary><strong>架构总览</strong></summary>

```
User --> Claude Code / CLI
          |
          v
    Orchestration Layer
    (MCP Server, Router, 27 Hooks)
          |
          v
    Swarm Coordination
    (Queen, Topology, Consensus)
          |
          v
    100+ Specialized Agents
    (coder, tester, reviewer, architect, security...)
          |
          v
    Memory & Learning
    (AgentDB, HNSW, SONA, ReasoningBank)
          |
          v
    LLM Providers
    (Claude, GPT, Gemini, Cohere, Ollama)
```

</details>

---

## 文档

四份文档，面向四类读者：

| 文档 | 何时阅读 |
|-----|-----------------|
| **[状态](docs/STATUS.md)** | 了解当前可用功能——能力计数、测试基线、近期修复、下一步计划。*是否已就绪*文档。 |
| **[用户指南](docs/USERGUIDE.md)** | 日常参考——每条命令、每个配置项、每个插件。*该怎么做*文档。 |
| **[MetaHarness 指南](docs/metaharness-user-guide.md)** | 如何为智能体配置打分、扫描工具配置中的安全问题、检测运行间变更，以及把项目抽取为独立智能体工具包。*审计我的配置*文档。 |
| **[基准测试](https://gist.github.com/ruvnet/298f8c668c8859b369f91734a0e9cbbe)** | v3.8.0 在 darwin-arm64 + linux-x64 上与 LangGraph / AutoGen / CrewAI 的 SOTA 对比矩阵。ruflo 在冷启动、单轮、RSS 上快 1.3×–1953×。*是否够快*文档。 |
| **[验证](verification.md)** | 用密码学方式证明已安装的字节与签名见证一致——`ruflo verify`。*信任但验证*文档。 |
| **[团队网关检查清单](docs/TEAM-GATEWAY-CHECKLIST.md)** | 合并前门禁、双模式交接、记忆命名空间共享、每次合并的见证清单条目。*更安全的团队协作*文档。 |

基准测试内部资料（用于复现）：[`sota-workload-spec.md`](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/sota-workload-spec.md) · [`SOTA-PROGRESS.md`](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/SOTA-PROGRESS.md) · [原始矩阵 JSON：darwin](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/sota-matrix.json) · [linux](https://github.com/ruvnet/ruflo/blob/perf/sota-comparator-benchmarks/docs/benchmarks/sota-matrix-linux.json)

用户指南章节索引：

| 章节 | 主题 |
|---------|--------|
| [快速开始](docs/USERGUIDE.md#quick-start) | 安装、前置条件、安装配置 |
| [核心功能](docs/USERGUIDE.md#-core-features) | MCP 工具、智能体、记忆、神经学习 |
| [智能与学习](docs/USERGUIDE.md#-intelligence--learning) | 钩子、工作者、SONA、模型路由 |
| [蜂群与协调](docs/USERGUIDE.md#-swarm--coordination) | 拓扑、共识、蜂巢心智 |
| [安全](docs/USERGUIDE.md#%EF%B8%8F-security) | AIDefence、CVE 修复、校验 |
| [生态系统](docs/USERGUIDE.md#-ecosystem--integrations) | RuVector、agentic-flow、Flow Nexus |
| [配置](docs/USERGUIDE.md#%EF%B8%8F-configuration--reference) | 环境变量、配置 schema |
| [插件市场](https://ruvnet.github.io/ruflo) | 浏览与安装插件 |

---

## 支持

| 资源 | 链接 |
|----------|------|
| 文档 | [用户指南](docs/USERGUIDE.md) |
| 问题与缺陷 | [GitHub Issues](https://github.com/ruvnet/claude-flow/issues) |
| 企业服务 | [ruv.io](https://ruv.io) |
| 社区 | [Agentics Foundation Discord](https://discord.com/invite/dfxmpwkG2D) |
| 由以下提供支持 | [Cognitum.one](https://cognitum.one) |

## 许可证

MIT - [RuvNet](https://github.com/ruvnet)
