# sensordata-forwarder

## Executive Summary

`sensordata-forwarder` 是一个基于 Bun 与 TypeScript 实现的 E 生态数据转发管道。项目围绕《e生态开放接口文档 ver3.1.9》实现核心能力：

1. 从配置文件加载 `appid` 与 `secret`；
2. 通过 `/v3/devices` 拉取设备列表；
3. 按设备调用 E 生态 API 拉取数据，支持普通设备与压电式雨量计两类数据结构；
4. 通过 **连接器（Connector）** 将每个 datapoint 转换并转发到客户平台（MQTT、HTTP 等）。

项目提供两种运行模式：

| 模式 | 适用场景 | 配置关键字 |
| --- | --- | --- |
| **Connector 模式**（推荐） | 客户自定义转发逻辑，连接器自行管理连接和协议 | `connector` |
| Converter 模式（传统） | 简单数据变换 + 配置化输出 | `converter` + `routing` + `outputs` |

## Table of Contents

- [架构设计](#架构设计)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [连接器开发指南](#连接器开发指南)
- [配置说明](#配置说明)
- [运行方式](#运行方式)
- [传统 Converter 模式](#传统-converter-模式)
- [与 E 生态接口文档的映射关系](#与-e-生态接口文档的映射关系)

## 架构设计

```mermaid
flowchart LR
  A[config/config.json] --> B[Config Loader]
  B --> C[EcoisClient]
  C --> D[/v3/token]
  C --> E[/v3/devices]
  C --> F[/v3/device/{sn}/data*]
  F --> G[Normalized Datapoints]
  G --> H{模式?}
  H -->|Connector| I[Connector Module]
  I --> J[MQTT / HTTP / ...]
  H -->|Converter| K[Converter Script]
  K --> L[Output Router]
  L --> M[HTTP Endpoint]
  L --> N[MQTT Broker]
  G --> O[State Store]
```

### 设计原则

| 设计点 | 实现方式 | 价值 |
| --- | --- | --- |
| 连接器自包含 | 每个连接器独立管理连接、协议、数据格式 | 灵活适配不同客户平台 |
| 配置与代码解耦 | 所有凭据、设备过滤、抓取模式均在 JSON 配置中定义 | 降低部署修改成本 |
| 数据标准化 | 将普通设备与雨量计数据统一成 `NormalizedDatapoint` | 降低连接器开发复杂度 |
| 幂等控制 | 使用 `data/state.json` 保存每个流的 `lastForwardedTimestamp` | 避免重复发送 |
| 可靠调用 | token 缓存 + HTTP 重试 + 超时控制 | 提高生产稳定性 |

## 目录结构

```text
.
├── connectors/                          # 连接器目录
│   ├── example-connector.ts             # 连接器模板（参考用）
│   └── xkh-connector.ts                # XKH 平台连接器
├── config/
│   ├── config.json.example              # 传统模式配置模板
│   ├── example.config.json              # 传统模式完整示例
│   └── example.connector-config.json    # 连接器模式配置示例
├── data/
├── scripts/
│   └── default-converter.ts             # 默认转换脚本（传统模式）
├── src/
│   ├── core/
│   │   ├── config.ts
│   │   ├── connector-loader.ts          # 连接器动态加载
│   │   ├── converter.ts
│   │   ├── ecois-client.ts
│   │   ├── http.ts
│   │   ├── output-router.ts
│   │   ├── pipeline.ts
│   │   ├── state.ts
│   │   └── types.ts
│   ├── endpoints/
│   │   ├── http-output.ts
│   │   └── mqtt-output.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── mqtt-helper.ts               # MQTT 连接池工具
│   │   └── time.ts
│   └── index.ts
└── test/
    └── config.test.ts
```

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 创建配置文件

```bash
cp config/example.connector-config.json config/config.json
```

编辑 `config/config.json`，填入 E 生态凭据：

```json
{
  "api": {
    "appid": "your-appid",
    "secret": "your-secret"
  },
  "connector": {
    "scriptPath": "./connectors/xkh-connector.ts"
  }
}
```

### 3. 运行

```bash
bun run dev
```

## 连接器开发指南

连接器是一个自包含的 TypeScript 模块，负责接收标准化数据并转发到目标平台。

### 连接器接口

```ts
import type { Connector, ConnectorContext, ConnectorLogger } from "../src/core/types.ts";

interface Connector {
  name: string;
  init?(logger: ConnectorLogger): Promise<void>;   // 初始化连接
  forward(context: ConnectorContext): Promise<void>; // 转发单个数据点
  close?(): Promise<void>;                           // 清理连接
}
```

### ConnectorContext

每次调用 `forward()` 时，系统传入以下上下文：

```ts
interface ConnectorContext {
  device: DeviceSummary;       // 设备信息（sn, type, alias, location 等）
  datapoint: NormalizedDatapoint; // 标准化数据点
  streamKey: string;           // 数据流标识
  logger: ConnectorLogger;     // 日志工具
}
```

### NormalizedDatapoint 数据结构

```ts
interface NormalizedDatapoint {
  timestamp: number;           // Unix 时间戳（毫秒）
  datetime?: string;           // 可读时间
  kind: "standard" | "pluviometer";
  nodeValues: Record<string, Record<string, unknown>>; // 节点 → 参数 → 值
  sensors: Record<string, unknown>;    // 雨量计传感器数据
  flatValues: Record<string, unknown>; // 扁平化的 "node.param": value
  lng?: number;
  lat?: number;
  raw: unknown;                // 原始 API 响应
}
```

### 开发步骤

1. 复制模板：
   ```bash
   cp connectors/example-connector.ts connectors/my-connector.ts
   ```

2. 实现 `init()`：建立 MQTT/HTTP 等连接

3. 实现 `forward()`：将 `datapoint` 转换为目标格式并发送

4. 实现 `close()`：关闭连接

5. 在 `config.json` 中指定：
   ```json
   { "connector": { "scriptPath": "./connectors/my-connector.ts" } }
   ```

### MQTT 连接池工具

项目提供了 `MqttConnectionPool`，支持按 clientId 复用连接：

```ts
import { MqttConnectionPool } from "../src/utils/mqtt-helper.ts";

const pool = new MqttConnectionPool({
  brokerUrl: "mqtt://broker:1883",
  username: "user",
  password: "pass",
}, logger);

// 每个设备使用独立的 clientId
const client = await pool.getClient(`client_${device.sn}`);
await client.publishAsync(topic, payload, { qos: 0 });

// 关闭所有连接
await pool.closeAll();
```

## 配置说明

### Connector 模式（推荐）

```json
{
  "api": {
    "appid": "your-appid",
    "secret": "your-secret"
  },
  "devices": {
    "fetch": { "mode": "latest" }
  },
  "connector": {
    "scriptPath": "./connectors/xkh-connector.ts"
  },
  "state": { "path": "./data/state.json" },
  "logging": { "level": "info" }
}
```

### 关键配置项

| 配置路径 | 类型 | 说明 |
| --- | --- | --- |
| `api.appid` | string | E 生态开放接口应用 ID |
| `api.secret` | string | E 生态开放接口应用密钥 |
| `devices.fetch.mode` | enum | `incremental` / `latest` / `range` / `pluviometerLatest` / `pluviometerHistory` |
| `devices.includeSerials` | string[] | 仅处理指定设备（空数组 = 全部） |
| `devices.excludeSerials` | string[] | 排除指定设备 |
| `devices.overrides` | object | 按设备 SN 覆盖抓取策略 |
| `connector.scriptPath` | string | 连接器脚本路径 |
| `connector.exportName` | string | 导出函数名（默认 `"default"`） |
| `state.path` | string | 已转发状态文件路径 |

## 运行方式

### 本地开发

```bash
bun run dev
```

### 指定配置运行

```bash
bun run src/index.ts -- --pipeline-config ./config/config.json
```

### 类型检查

```bash
bun run check
```

### 测试

```bash
bun test
```

## 传统 Converter 模式

如果只需要简单的数据变换（不需要自定义连接管理），可以使用传统的 Converter 模式。

配置中使用 `converter` + `routing` + `outputs` 代替 `connector`：

```json
{
  "converter": {
    "scriptPath": "./scripts/default-converter.ts",
    "exportName": "default"
  },
  "routing": {
    "defaultOutputIds": ["http-primary"]
  },
  "outputs": [
    {
      "id": "http-primary",
      "type": "http",
      "url": "https://example.com/iot/ingest"
    }
  ]
}
```

详见 `config/example.config.json`。

## 与 E 生态接口文档的映射关系

| 文档接口 | 项目实现 | 用途 |
| --- | --- | --- |
| `/v3/token` | `EcoisClient.getToken()` | 获取并缓存访问 token |
| `/v3/devices` | `EcoisClient.listDevices()` | 拉取账户下设备列表 |
| `/v3/device/{sn}/data` | `fetchDeviceData(... mode=range)` | 指定时间范围拉取普通设备数据 |
| `/v3/device/{sn}/data/incremental` | `fetchDeviceData(... mode=incremental)` | 增量同步普通设备数据 |
| `/v3/device/{sn}/latest` | `fetchDeviceData(... mode=latest)` | 获取最新一包普通设备数据 |
| `/v3/device/pluviometer/{sn}/data/history` | `fetchDeviceData(... mode=pluviometerHistory)` | 拉取压电式雨量计时间序列 |
| `/v3/device/pluviometer/{sn}/data/latest` | `fetchDeviceData(... mode=pluviometerLatest)` | 获取压电式雨量计最新点 |
