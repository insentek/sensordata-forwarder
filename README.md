# sensordata-forwarder

## Executive Summary

`sensordata-forwarder` 是一个基于最新 Bun 与 TypeScript 实现的 E 生态数据转发管道。项目围绕你提供的《e生态开放接口文档 ver3.1.9》实现四个核心能力：

1. 从配置文件加载 `appid` 与 `secret`；
2. 通过 `/v3/devices` 拉取设备列表；
3. 按设备调用 E 生态 API 拉取数据，支持普通设备与压电式雨量计两类数据结构；
4. 动态加载外部转换脚本，以每个 datapoint 为输入，生成新的 payload，并转发到 HTTP 或 MQTT 等下游端点。

## Table of Contents

- [架构设计](#架构设计)
- [目录结构](#目录结构)
- [配置说明](#配置说明)
- [运行方式](#运行方式)
- [外部转换脚本接口](#外部转换脚本接口)
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
  G --> H[External Converter Script]
  H --> I[Outbound Router]
  I --> J[HTTP Endpoint]
  I --> K[MQTT Broker]
  G --> L[State Store]
```

### 设计原则

| 设计点 | 实现方式 | 价值 |
| --- | --- | --- |
| 配置与代码解耦 | 所有凭据、设备过滤、抓取模式、下游输出均在 JSON 配置中定义 | 降低部署修改成本 |
| 数据标准化 | 将普通设备 `list[]/increments[]` 与雨量计 `timeline+sensors` 统一成 `NormalizedDatapoint` | 降低脚本开发复杂度 |
| 扩展隔离 | 转换脚本与发送器均为独立模块 | 便于后续增加 Kafka、AMQP、S3 等输出 |
| 幂等控制 | 使用 `data/state.json` 保存每个流的 `lastForwardedTimestamp` | 避免重复发送 |
| 可靠调用 | token 缓存 + HTTP 重试 + 超时控制 | 提高生产稳定性 |

## 目录结构

```text
.
├── config/
│   ├── example.config.json
│   └── config.json.example
├── data/
├── scripts/
│   └── default-converter.ts
├── src/
│   ├── core/
│   │   ├── config.ts
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
│   │   └── logger.ts
│   └── index.ts
└── test/
    └── config.test.ts
```

## 配置说明

### 1. 复制配置模板

```bash
cp config/config.json.example config/config.json
```

### 2. 填写 E 生态凭据

```json
{
  "api": {
    "appid": "your-appid",
    "secret": "your-secret"
  }
}
```

### 3. 关键配置项

| 配置路径 | 类型 | 说明 |
| --- | --- | --- |
| `api.appid` | string | E 生态开放接口应用 ID |
| `api.secret` | string | E 生态开放接口应用密钥 |
| `devices.fetch.mode` | enum | `incremental` / `latest` / `range` / `pluviometerLatest` / `pluviometerHistory` |
| `devices.overrides` | object | 按设备 SN 覆盖抓取策略 |
| `converter.scriptPath` | string | 外部转换脚本路径 |
| `converter.exportName` | string | 使用的导出函数名 |
| `routing.defaultOutputIds` | string[] | 默认输出目标 |
| `outputs[]` | array | HTTP / MQTT 输出配置 |
| `state.path` | string | 已转发状态文件路径 |

## 运行方式

### 安装依赖

```bash
bun install
```

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

## 外部转换脚本接口

`scripts/default-converter.ts` 展示了最小可用脚本。系统会对每一个 datapoint 调用一次脚本。

### 输入结构

```ts
interface ConverterContext {
  device: DeviceSummary;
  datapoint: NormalizedDatapoint;
  streamKey: string;
  state: {
    lastForwardedTimestamp?: number;
  };
}
```

### 返回方式

脚本可以返回以下任一形式：

1. `null` / `undefined`：跳过当前点；
2. 普通对象：系统会将其作为 `payload`；
3. `{ payload, outputIds, topic, path, headers, qos, retain }`：完整控制下游发送；
4. 上述对象数组：一次 datapoint 发送到多个目标。

### MQTT 定向示例

```ts
export default async function convert({ device, datapoint }) {
  return {
    outputIds: ["mqtt-primary"],
    topic: `sensor/${device.sn}/telemetry`,
    qos: 1,
    payload: {
      sn: device.sn,
      ts: datapoint.timestamp,
      values: datapoint.flatValues,
    },
  };
}
```

### HTTP 定向示例

```ts
export default async function convert({ device, datapoint }) {
  return {
    outputIds: ["http-primary"],
    path: `/devices/${device.sn}/ingest`,
    headers: {
      "x-device-sn": device.sn,
    },
    payload: {
      timestamp: datapoint.timestamp,
      data: datapoint.flatValues,
    },
  };
}
```

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

## 建议的下一步扩展

1. 增加 cron 或守护式轮询调度；
2. 增加 DLQ（死信队列）与失败重放；
3. 增加 Kafka / Redis Stream / AMQP 输出；
4. 增加设备描述 `/v3/device/{sn}/description` 的字段字典缓存，用于更丰富的业务映射。