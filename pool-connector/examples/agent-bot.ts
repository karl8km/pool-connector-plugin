/**
 * Agent Bot - 完整的 AI Agent 机器人示例
 * 
 * 展示如何创建一个完整的 AI Agent，集成 LLM 和 Comm-Pool
 */

import { PoolConnector } from '../index';
import type { Message, AgentRole } from '../types';

interface AgentBotConfig {
    role: AgentRole;
    name: string;
    poolUrl: string;
    apiKey: string;
    llmApiKey: string;
    defaultTopic: string;
    systemPrompt: string;
}

/**
 * AI Agent Bot 类
 * 
 * 一个完整的 AI Agent 实现，具备：
 * - 接收和响应消息
 * - 上下文管理
 * - LLM 集成
 * - 自动结论生成
 */
export class AgentBot {
    private connector: PoolConnector;
    private config: AgentBotConfig;
    private isRunning: boolean = false;
    private messageQueue: Message[] = [];
    
    constructor(config: AgentBotConfig) {
        this.config = config;
        
        this.connector = new PoolConnector({
            poolUrl: config.poolUrl,
            apiKey: config.apiKey,
            agentRole: config.role,
            agentName: config.name,
            defaultTopic: config.defaultTopic,
            enableWebSocket: true
        });
    }
    
    /**
     * 启动 Agent
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log(`[${this.config.name}] Agent 已经在运行`);
            return;
        }
        
        // 初始化插件
        await this.connector.initialize({
            logger: {
                info: (msg: string, ...args: any[]) => console.log(`[${this.config.name}]`, msg, ...args),
                warn: (msg: string, ...args: any[]) => console.warn(`[${this.config.name}]`, msg, ...args),
                error: (msg: string, ...args: any[]) => console.error(`[${this.config.name}]`, msg, ...args),
                debug: (msg: string, ...args: any[]) => console.log(`[${this.config.name}]`, msg, ...args)
            },
            config: {},
            getAgent: () => null
        });
        
        // 设置消息监听
        this.setupMessageHandlers();
        
        this.isRunning = true;
        console.log(`[${this.config.name}] Agent 已启动 (${this.config.role})`);
        
        // 发送上线通知
        await this.connector.sendMessage({
            content: `${this.config.name} 已上线，准备接收任务`,
            receiverRole: 'all'
        });
    }
    
    /**
     * 停止 Agent
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        await this.connector.dispose();
        console.log(`[${this.config.name}] Agent 已停止`);
    }
    
    /**
     * 设置消息处理器
     */
    private setupMessageHandlers(): void {
        // 监听所有消息
        this.connector.onMessage('*', async (message: Message) => {
            // 忽略自己的消息
            if (message.sender_role === this.config.role) {
                return;
            }
            
            // 检查是否是发给自己的
            if (message.receiver_role !== this.config.role && message.receiver_role !== 'all') {
                return;
            }
            
            // 添加到队列
            this.messageQueue.push(message);
            
            // 处理消息
            await this.processMessage(message);
        });
    }
    
    /**
     * 处理接收到的消息
     */
    private async processMessage(message: Message): Promise<void> {
        console.log(`[${this.config.name}] 收到消息:`, message.content.slice(0, 50));
        
        try {
            // 根据消息类型和内容决定如何处理
            if (this.shouldRespond(message)) {
                const response = await this.generateResponse(message);
                
                if (response) {
                    await this.connector.sendMessage({
                        content: response,
                        receiverRole: message.sender_role as AgentRole | 'all',
                        threadId: message.thread_id,
                        parentId: message.id
                    });
                }
            }
        } catch (error) {
            console.error(`[${this.config.name}] 处理消息失败:`, error);
        }
    }
    
    /**
     * 判断是否应该回复
     */
    private shouldRespond(message: Message): boolean {
        // 直接 @ 我
        if (message.content.includes(`@${this.config.role}`)) {
            return true;
        }
        
        // 发给我或所有人
        if (message.receiver_role === this.config.role || message.receiver_role === 'all') {
            // 检查是否需要我的专业知识
            return this.isRelevantToMyRole(message.content);
        }
        
        return false;
    }
    
    /**
     * 判断内容是否与我的角色相关
     */
    private isRelevantToMyRole(content: string): boolean {
        const lowerContent = content.toLowerCase();
        
        const roleKeywords: Record<AgentRole, string[]> = {
            'GM': ['目标', '战略', '方向', '决策', '优先级'],
            'PM': ['需求', '计划', '进度', '排期', '资源'],
            'TE': ['架构', '技术', '方案', '设计', '性能'],
            'SE': ['实现', '代码', '开发', 'bug', '测试'],
            'System': []
        };
        
        const keywords = roleKeywords[this.config.role] || [];
        return keywords.some(kw => lowerContent.includes(kw));
    }
    
    /**
     * 生成回复（模拟 LLM 调用）
     * 
     * 实际使用时，这里应该调用真实的 LLM API
     */
    private async generateResponse(message: Message): Promise<string | null> {
        // 获取上下文
        const context = await this.connector.getContextWindow({
            threadId: message.thread_id,
            includeConclusions: true
        });
        
        // 构建 prompt
        const prompt = this.buildPrompt(message, context);
        
        // 模拟 LLM 响应（实际使用时调用 LLM API）
        return this.mockLLMResponse(prompt, message);
    }
    
    /**
     * 构建 LLM Prompt
     */
    private buildPrompt(message: Message, context: string): string {
        return `
${this.config.systemPrompt}

=== 对话上下文 ===
${context}

=== 当前消息 ===
[${message.sender_role}]: ${message.content}

=== 你的角色 ===
你是 ${this.config.name} (${this.config.role})

请根据上下文和当前消息，给出专业的回复。
如果是技术问题，请提供具体的解决方案。
如果是需求讨论，请明确表达你的观点。
        `.trim();
    }
    
    /**
     * 模拟 LLM 响应
     * 
     * 实际使用时替换为真实的 LLM API 调用
     */
    private mockLLMResponse(prompt: string, originalMessage: Message): string {
        const roleResponses: Record<AgentRole, string[]> = {
            'TE': [
                '从技术角度分析，我建议采用微服务架构，这样可以更好地解耦各个模块。',
                '这个方案在技术上是可行的，但需要考虑数据库迁移的风险。',
                '我建议使用 Redis 作为缓存层，可以显著提升读取性能。',
                '关于技术选型，我推荐使用 Node.js + TypeScript，团队熟悉度较高。'
            ],
            'SE': [
                '这个功能我可以实现，预计需要 2 天时间。',
                '代码实现上需要注意异常处理，我会添加 try-catch 块。',
                '我已经完成了核心功能的开发，正在进行单元测试。',
                '发现了一个边界情况，需要 PM 确认一下需求细节。'
            ],
            'PM': [
                '需求已确认，可以进入开发阶段。',
                '考虑到时间成本，我建议先实现 MVP 版本。',
                '用户反馈这个功能优先级较高，请优先处理。',
                '下周的迭代计划已经排好，请按优先级执行。'
            ],
            'GM': [
                '这个方向符合我们的战略目标，可以继续推进。',
                '需要评估一下 ROI，确保投入产出比合理。',
                '建议先进行小范围试点，验证效果后再推广。',
                '这个决策我支持，请团队全力执行。'
            ],
            'System': []
        };
        
        const responses = roleResponses[this.config.role];
        if (responses && responses.length > 0) {
            const randomResponse = responses[Math.floor(Math.random() * responses.length)];
            return `[${this.config.role}回复] ${randomResponse}`;
        }
        
        return '';
    }
    
    /**
     * 发布结论
     */
    async publishConclusion(content: string, threadId?: string): Promise<void> {
        await this.connector.publishConclusion(content, {
            topic: this.config.defaultTopic,
            threadId
        });
    }
    
    /**
     * 主动发起讨论
     */
    async initiateDiscussion(topic: string, content: string): Promise<string> {
        const result = await this.connector.createThread(
            this.config.defaultTopic,
            topic
        );
        
        await this.connector.sendMessage({
            content,
            threadId: result.threadId,
            receiverRole: 'all'
        });
        
        return result.threadId;
    }
    
    /**
     * 获取状态
     */
    getStatus(): {
        isRunning: boolean;
        role: AgentRole;
        name: string;
        queueSize: number;
    } {
        return {
            isRunning: this.isRunning,
            role: this.config.role,
            name: this.config.name,
            queueSize: this.messageQueue.length
        };
    }
}

// ==================== 使用示例 ====================

/**
 * 创建并启动多个 Agent
 */
async function runMultiAgentDemo() {
    const baseConfig = {
        poolUrl: 'https://comm-pool.your-domain.workers.dev',
        apiKey: (globalThis as any).process?.env?.COMM_POOL_API_KEY || '',
        llmApiKey: (globalThis as any).process?.env?.LLM_API_KEY || '',
        defaultTopic: 'Demo-Project'
    };
    
    // 创建 TE Agent
    const teAgent = new AgentBot({
        ...baseConfig,
        role: 'TE',
        name: 'TE-Agent-01',
        systemPrompt: `你是技术专家 (TE)，负责：
- 评估技术可行性
- 提供架构建议
- 审查技术方案
- 识别技术风险

回复要专业、简洁，重点突出技术要点。`
    });
    
    // 创建 SE Agent
    const seAgent = new AgentBot({
        ...baseConfig,
        role: 'SE',
        name: 'SE-Agent-01',
        systemPrompt: `你是软件工程师 (SE)，负责：
- 实现功能需求
- 编写高质量代码
- 进行单元测试
- 修复 Bug

回复要具体，包含实现细节和注意事项。`
    });
    
    // 创建 PM Agent
    const pmAgent = new AgentBot({
        ...baseConfig,
        role: 'PM',
        name: 'PM-Agent-01',
        systemPrompt: `你是产品经理 (PM)，负责：
- 定义产品需求
- 制定开发计划
- 协调团队资源
- 跟踪项目进度

回复要明确，包含具体的行动项和时间节点。`
    });
    
    // 启动所有 Agent
    await Promise.all([
        teAgent.start(),
        seAgent.start(),
        pmAgent.start()
    ]);
    
    // PM 发起讨论
    console.log('\n=== PM 发起需求讨论 ===\n');
    const threadId = await pmAgent.initiateDiscussion(
        '【需求讨论】用户评论功能',
        `
我们需要实现一个用户评论系统，支持以下功能：
1. 一级评论和二级回复
2. 评论点赞
3. 评论审核
4. 敏感词过滤

请 TE 评估技术方案，SE 评估工作量。
        `.trim()
    );
    
    // 等待一段时间后，PM 发布结论
    setTimeout(async () => {
        console.log('\n=== PM 发布结论 ===\n');
        await pmAgent.publishConclusion(`
【结论】用户评论功能开发方案

经过讨论，达成以下共识：
1. 采用 MongoDB 存储评论数据
2. 使用 Redis 缓存热门评论
3. 开发周期：5 天
4. 负责人：SE-Agent-01

立即开始执行。
        `.trim(), threadId);
    }, 10000);
    
    // 返回 Agent 实例以便控制
    return { teAgent, seAgent, pmAgent };
}

// 导出
export { runMultiAgentDemo };
