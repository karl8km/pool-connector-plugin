# Pool Connector Plugin for OpenClaw

OpenClaw 的 Pool Connector 插件，用于连接 OpenClaw 与 Comm-Pool 服务，实现多 Agent 协作。

## 功能特性

- 🔌 消息发送/接收适配
- 🔗 WebSocket 长连接维护
- 📋 线程管理（ThreadManager）
- 💾 Token 压缩与上下文管理（TokenCompressor）
- 🚀 增强版多项目协作（EnhancedPoolConnector）
- 📝 结构化消息支持（v2.0 格式）

## 安装

### 从 GitHub 安装

```bash
npm install git+https://github.com/karl8km/pool-connector-plugin.git
```

或使用 yarn：

```bash
yarn add git+https://github.com/karl8km/pool-connector-plugin.git
```

## 快速开始

### 基础使用（PoolConnector）

```typescript
import { PoolConnector } from 'pool-connector-plugin';

const connector = new PoolConnector({
    poolUrl: 'https://xxxx.xxx.com',
    apiKey: 'xxxxx',
    agentRole: 'PM',
    agentName: 'MyPM'
});

// 初始化
await connector.initialize(context);

// 发送消息
await connector.sendMessage({
    content: 'Hello World!',
    topic: 'General',
    receiverRole: 'all'
});

// 订阅消息
connector.onMessage('*', (message) => {
    console.log(`收到消息: ${message.sender_role} -> ${message.content}`);
});
```

### 增强版使用（EnhancedPoolConnector）

```typescript
import { EnhancedPoolConnector } from 'pool-connector-plugin';

const connector = new EnhancedPoolConnector({
    poolUrl: 'https://xxxx.xxx.com',
    apiKey: 'supermima123',
    agentRole: 'PM',
    agentName: 'PM-01',
    instanceId: 'PM-01'
});

// 注册指令处理器
connector.onCommand('evaluate', async (command) => {
    console.log(`收到评估指令: ${command.title}`);
    
    // 发送回复
    await connector.sendResponse({
        projectId: command.projectId,
        projectName: command.projectId,
        parentMessageId: command.messageId,
        taskId: command.taskId,
        body: '评估完成...',
        status: 'completed',
        toRole: command.senderRole,
        toInstanceId: command.senderInstanceId
    });
});

// 发送指令
await connector.sendCommand({
    projectId: 'proj_001',
    projectName: '测试项目',
    commandType: 'evaluate',
    taskId: 'task_001',
    title: '测试指令',
    body: '这是一条测试指令',
    targetRole: 'TE',
    requiresResponse: true,
    priority: 'high'
});
```

## API 参考

### PoolConnector 类

| 方法 | 说明 |
|------|------|
| `initialize(context)` | 初始化插件 |
| `sendMessage(params)` | 发送消息 |
| `replyToMessage(parentId, content, options)` | 回复消息 |
| `publishConclusion(content, options)` | 发布结论 |
| `getThreadHistory(threadId, options)` | 获取线程历史（带压缩） |
| `getContextWindow(params)` | 获取上下文窗口 |
| `onMessage(topic, handler)` | 订阅消息 |
| `offMessage(topic, handler)` | 取消订阅 |
| `waitForReply(params)` | 等待回复 |
| `createThread(topic, initialMessage)` | 创建新线程 |
| `getActiveThreads(topic)` | 获取活跃线程 |
| `extractConclusion(threadId)` | 提取结论 |

### EnhancedPoolConnector 类

| 方法 | 说明 |
|------|------|
| `sendCommand(command)` | 发送结构化指令 |
| `sendResponse(params)` | 发送结构化回复 |
| `sendStatusUpdate(projectId, projectName, status, details)` | 发送状态更新 |
| `onCommand(commandType, handler)` | 注册指令处理器 |
| `waitForCommandResponse(taskId, timeout)` | 等待指令回复 |
| `getPendingCommands()` | 获取待处理指令列表 |
| `switchProject(projectId)` | 切换当前项目 |
| `getCurrentProjectContext()` | 获取当前项目上下文 |
| `parseStructuredMessage(message)` | 解析结构化消息 |
| `completeCommand(taskId, response, deliverables)` | 完成指令 |

## 配置选项

### PoolConnectorConfig

```typescript
interface PoolConnectorConfig {
    poolUrl: string;                    // comm-pool-node 服务地址
    apiKey: string;                     // API 密钥
    agentRole: AgentRole;               // Agent 角色（PM/TE/SE/GM）
    agentName: string;                  // Agent 名称
    defaultTopic?: string;              // 默认 topic（默认: "General"）
    enableWebSocket?: boolean;          // 是否启用 WebSocket（默认: true）
    maxContextTokens?: number;          // 最大上下文 Token 数（默认: 4000）
    compressionThreshold?: number;      // 压缩阈值（默认: 3000）
}
```

### EnhancedConnectorConfig

```typescript
interface EnhancedConnectorConfig extends PoolConnectorConfig {
    instanceId: string;                 // Agent 实例 ID（如 "PM-01"）
    currentProjectId?: string;          // 当前项目 ID
}
```

## 开发

### 构建

```bash
npm install
npm run build
```

### 监听模式开发

```bash
npm run dev
```

## 发布到 GitHub

### 1. 初始化 Git 仓库

```bash
cd pool-connector-plugin
git init
git add .
git commit -m "Initial commit"
```

### 2. 创建 GitHub 仓库

在 GitHub 上创建一个新仓库，命名为 `pool-connector-plugin`

### 3. 推送到 GitHub

```bash
git remote add origin https://github.com/karl8km/pool-connector-plugin.git
git branch -M main
git push -u origin main
```

### 4. 创建版本标签（可选）

```bash
git tag -a v1.0.0 -m "Version 1.0.0"
git push origin v1.0.0
```

## 许可证

MIT
