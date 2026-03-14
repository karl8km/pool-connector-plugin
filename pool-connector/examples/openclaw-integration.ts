/**
 * OpenClaw 集成示例
 * 
 * 展示如何在 OpenClaw 框架中使用 Pool Connector 插件
 */

import { PoolConnector, PoolConnectorConfig } from '../index';
import type { AgentRole, Message, PluginContext } from '../types';

// ==================== 1. 基础配置示例 ====================

/**
 * PM Agent 配置
 */
const pmConfig: PoolConnectorConfig = {
    poolUrl: 'https://comm-pool.your-domain.workers.dev',
    apiKey: (globalThis as any).process?.env?.COMM_POOL_API_KEY || '',
    agentRole: 'PM',
    agentName: 'PM-Agent-01',
    defaultTopic: 'Project-Alpha',
    enableWebSocket: true,
    maxContextTokens: 4000,
    compressionThreshold: 3000
};

/**
 * SE Agent 配置
 */
const seConfig: PoolConnectorConfig = {
    poolUrl: 'https://comm-pool.your-domain.workers.dev',
    apiKey: (globalThis as any).process?.env?.COMM_POOL_API_KEY || '',
    agentRole: 'SE',
    agentName: 'SE-Agent-01',
    defaultTopic: 'Project-Alpha',
    enableWebSocket: true
};

// ==================== 2. 插件初始化示例 ====================

/**
 * 创建模拟的 PluginContext
 */
function createMockContext(): PluginContext {
    return {
        logger: {
            info: (msg: string, ...args: any[]) => console.log('[INFO]', msg, ...args),
            warn: (msg: string, ...args: any[]) => console.warn('[WARN]', msg, ...args),
            error: (msg: string, ...args: any[]) => console.error('[ERROR]', msg, ...args),
            debug: (msg: string, ...args: any[]) => console.log('[DEBUG]', msg, ...args)
        },
        config: {},
        getAgent: (role: AgentRole) => null
    };
}

/**
 * 初始化 PM Agent
 */
async function initializePMAgent() {
    const connector = new PoolConnector(pmConfig);
    const context = createMockContext();
    
    await connector.initialize(context);
    
    return connector;
}

// ==================== 3. 消息通信示例 ====================

/**
 * PM 向团队发送需求
 */
async function sendRequirements(connector: PoolConnector) {
    // 发送需求到 General topic
    await connector.sendMessage({
        content: `
【需求文档 v1.0】用户认证模块

功能需求：
1. 支持邮箱+密码登录
2. 支持 OAuth (Google/GitHub)
3. 实现 JWT Token 刷新机制
4. 密码重置功能

技术约束：
- 使用现有 PostgreSQL 数据库
- 符合 GDPR 规范
- 响应时间 < 200ms

请 TE 评估技术可行性，SE 评估实现工作量。
        `.trim(),
        receiverRole: 'all',
        topic: 'Project-Alpha',
        isSummary: true
    });
}

/**
 * 回复特定消息
 */
async function replyToRequirement(connector: PoolConnector, parentId: number) {
    await connector.replyToMessage(parentId, `
技术评估报告：

✅ 技术可行性：可行
⚠️ 风险点：
1. OAuth 需要申请开发者账号
2. JWT 刷新需要处理并发场景

建议方案：
- 使用 Passport.js 处理 OAuth
- 使用 Redis 存储 Token 黑名单
- 预计开发周期：3 天
    `.trim(), {
        receiverRole: 'PM'
    });
}

/**
 * 发布结论
 */
async function publishDecision(connector: PoolConnector) {
    await connector.publishConclusion(`
【结论】用户认证模块开发方案

最终决定：
1. 采用 Passport.js + JWT 方案
2. 支持 Google/GitHub OAuth
3. 开发周期：3 天
4. 负责人：SE-Agent-01

下一步行动：
- SE 今天开始开发
- TE 明天进行代码审查
- PM 周五验收
    `.trim(), {
        topic: 'Project-Alpha'
    });
}

// ==================== 4. 消息监听示例 ====================

/**
 * 设置消息处理器
 */
function setupMessageHandlers(connector: PoolConnector) {
    // 监听所有消息
    connector.onMessage('*', (message: Message) => {
        console.log(`[${message.sender_role}] ${message.content.slice(0, 50)}...`);
    });
    
    // 监听特定 Topic
    connector.onMessage('Project-Alpha', (message: Message) => {
        if (message.is_conclusion) {
            console.log('📌 收到新结论:', message.content);
        }
    });
    
    // 监听发给 PM 的消息
    connector.onMessage('*', (message: Message) => {
        if (message.receiver_role === 'PM' || message.receiver_role === 'all') {
            handleMessageForPM(message);
        }
    });
}

function handleMessageForPM(message: Message) {
    // 根据消息内容决定如何响应
    if (message.content.includes('问题') || message.content.includes('？')) {
        console.log('需要回复问题:', message.content);
    }
    
    if (message.is_conclusion) {
        console.log('需要更新项目状态');
    }
}

// ==================== 5. 上下文管理示例 ====================

/**
 * 获取 LLM 上下文
 */
async function getLLMContext(connector: PoolConnector, threadId: string) {
    // 获取线程历史（自动压缩）
    const history = await connector.getThreadHistory(threadId, {
        limit: 50,
        compress: true
    });
    
    console.log(`Token 数量: ${history.tokenCount}`);
    console.log(`是否压缩: ${history.compressed}`);
    
    // 构建上下文窗口
    const context = await connector.getContextWindow({
        threadId,
        includeConclusions: true
    });
    
    return context;
}

/**
 * 等待回复
 */
async function waitForTEApproval(connector: PoolConnector, threadId: string) {
    console.log('等待 TE 的技术评估...');
    
    const reply = await connector.waitForReply({
        fromRole: 'TE',
        threadId,
        timeout: 60000, // 等待 60 秒
        checkInterval: 2000 // 每 2 秒检查一次
    });
    
    if (reply) {
        console.log('收到 TE 回复:', reply.content);
        return reply;
    } else {
        console.log('等待超时，需要提醒 TE');
        return null;
    }
}

// ==================== 6. 线程管理示例 ====================

/**
 * 创建新线程讨论特定主题
 */
async function createDiscussionThread(connector: PoolConnector) {
    const result = await connector.createThread(
        'Project-Alpha',
        '【讨论】数据库迁移方案'
    );
    
    console.log('新线程创建成功:', result.threadId);
    
    // 发送详细内容
    await connector.sendMessage({
        content: `
我们需要将用户数据从 MySQL 迁移到 PostgreSQL。

讨论要点：
1. 迁移策略（在线/离线）
2. 数据一致性保证
3. 回滚方案
4. 性能影响评估

请各位发表意见。
        `.trim(),
        threadId: result.threadId,
        receiverRole: 'all'
    });
    
    return result.threadId;
}

/**
 * 获取活跃线程
 */
async function checkActiveThreads(connector: PoolConnector) {
    const threads = await connector.getActiveThreads('Project-Alpha');
    
    console.log(`当前有 ${threads.length} 个活跃线程`);
    
    for (const thread of threads) {
        const summary = await connector.extractConclusion(thread.threadId);
        console.log(`- ${thread.threadId}: ${summary || '无结论'}`);
    }
}

// ==================== 7. 完整工作流示例 ====================

/**
 * 完整的协作工作流
 */
async function runCollaborationWorkflow() {
    const pm = await initializePMAgent();
    setupMessageHandlers(pm);
    
    // 1. PM 发布需求
    console.log('=== 步骤 1: PM 发布需求 ===');
    const result = await pm.sendMessage({
        content: '【需求】实现用户评论功能',
        receiverRole: 'all',
        isSummary: true
    });
    
    const threadId = result.threadId;
    
    // 2. 等待 TE 评估
    console.log('=== 步骤 2: 等待 TE 评估 ===');
    const teReply = await pm.waitForReply({
        fromRole: 'TE',
        threadId,
        timeout: 30000
    });
    
    if (!teReply) {
        console.log('TE 未响应，发送提醒');
        await pm.sendMessage({
            content: '@TE 请尽快评估技术可行性',
            threadId,
            receiverRole: 'TE'
        });
    }
    
    // 3. 等待 SE 评估
    console.log('=== 步骤 3: 等待 SE 评估 ===');
    const seReply = await pm.waitForReply({
        fromRole: 'SE',
        threadId,
        timeout: 30000
    });
    
    // 4. 获取完整上下文
    console.log('=== 步骤 4: 获取讨论上下文 ===');
    const context = await pm.getContextWindow({
        threadId,
        includeConclusions: false
    });
    
    console.log('上下文长度:', context.length);
    
    // 5. PM 做出决策并发布结论
    console.log('=== 步骤 5: 发布结论 ===');
    await pm.publishConclusion(`
【最终决策】用户评论功能

基于 TE 和 SE 的评估：
- 技术可行 ✅
- 工作量：2 天 ✅

决策：
1. 采用方案 A（嵌套评论）
2. 开发周期：2 天
3. 负责人：SE-Agent-01
4. 审查人：TE-Agent-01

立即开始执行。
    `.trim(), { threadId });
    
    // 6. 清理
    await pm.dispose();
}

// ==================== 8. 错误处理示例 ====================

/**
 * 带错误处理的消息发送
 */
async function safeSendMessage(connector: PoolConnector, content: string) {
    try {
        const result = await connector.sendMessage({
            content,
            receiverRole: 'all'
        });
        
        console.log('消息发送成功:', result.threadId);
        return result;
    } catch (error) {
        console.error('消息发送失败:', error);
        
        // 可以在这里实现重试逻辑或降级方案
        // 例如：保存到本地队列，稍后重试
        
        throw error;
    }
}

// ==================== 导出示例函数 ====================

export {
    pmConfig,
    seConfig,
    initializePMAgent,
    sendRequirements,
    replyToRequirement,
    publishDecision,
    setupMessageHandlers,
    getLLMContext,
    waitForTEApproval,
    createDiscussionThread,
    checkActiveThreads,
    runCollaborationWorkflow,
    safeSendMessage
};
