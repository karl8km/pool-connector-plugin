/**
 * Pool Connector Plugin for OpenClaw
 * 
 * 作为 OpenClaw 与 Comm-Pool 之间的桥梁，提供：
 * - 消息发送/接收适配
 * - 线程管理
 * - 结论提取
 * - Token 压缩与上下文管理
 */

import type { OpenClawPlugin, PluginContext, Message, AgentRole } from './types';
import { PoolClient } from './client';
import { ThreadManager } from './thread-manager';
import { TokenCompressor } from './token-compressor';

export interface PoolConnectorConfig {
    poolUrl: string;
    apiKey: string;
    agentRole: AgentRole;
    agentName: string;
    defaultTopic?: string;
    enableWebSocket?: boolean;
    maxContextTokens?: number;
    compressionThreshold?: number;
}

export class PoolConnector implements OpenClawPlugin {
    name = 'pool-connector';
    version = '2.0.0';
    
    protected config: PoolConnectorConfig;
    protected client: PoolClient;
    protected threadManager: ThreadManager;
    protected tokenCompressor: TokenCompressor;
    protected messageHandlers: Map<string, Function[]> = new Map();
    protected context?: PluginContext;
    
    constructor(config: PoolConnectorConfig) {
        this.config = {
            defaultTopic: 'General',
            enableWebSocket: true,
            maxContextTokens: 4000,
            compressionThreshold: 3000,
            ...config
        };
        
        this.client = new PoolClient({
            baseUrl: this.config.poolUrl,
            apiKey: this.config.apiKey
        });
        
        this.threadManager = new ThreadManager(this.client);
        this.tokenCompressor = new TokenCompressor({
            maxTokens: this.config.maxContextTokens!,
            threshold: this.config.compressionThreshold!
        });
    }
    
    /**
     * 插件初始化
     */
    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        this.context.logger.info(`[PoolConnector] 初始化完成 - Agent: ${this.config.agentName} (${this.config.agentRole})`);
        
        // 如果启用 WebSocket，建立连接
        if (this.config.enableWebSocket) {
            await this.setupWebSocket();
        }
    }
    
    /**
     * 设置 WebSocket 连接
     */
    private async setupWebSocket(): Promise<void> {
        const wsUrl = this.config.poolUrl.replace(/^http/, 'ws') + '/ws?topic=' + this.config.defaultTopic + '&clientId=' + this.config.agentName;
        
        try {
            const ws = new WebSocket(wsUrl);
            
            (ws as any).onopen = () => {
                this.context?.logger.info('[PoolConnector] WebSocket 连接已建立');
            };
            
            (ws as any).onmessage = (event: any) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleIncomingMessage(data);
                } catch (err) {
                    this.context?.logger.error('[PoolConnector] 解析消息失败:', err);
                }
            };
            
            (ws as any).onclose = () => {
                this.context?.logger.warn('[PoolConnector] WebSocket 连接已关闭');
                // 自动重连
                setTimeout(() => this.setupWebSocket(), 5000);
            };
            
            (ws as any).onerror = (error: any) => {
                this.context?.logger.error('[PoolConnector] WebSocket 错误:', error);
            };
        } catch (err) {
            this.context?.logger.error('[PoolConnector] WebSocket 连接失败:', err);
        }
    }
    
    /**
     * 处理接收到的消息
     */
    protected handleIncomingMessage(message: any): void {
        // 过滤自己发送的消息
        if (message.sender_role === this.config.agentRole) {
            return;
        }
        
        // 触发注册的处理器
        const handlers = this.messageHandlers.get(message.topic) || [];
        handlers.forEach(handler => {
            try {
                handler(message);
            } catch (err) {
                this.context?.logger.error('[PoolConnector] 消息处理器错误:', err);
            }
        });
        
        // 触发通用处理器
        const globalHandlers = this.messageHandlers.get('*') || [];
        globalHandlers.forEach(handler => {
            try {
                handler(message);
            } catch (err) {
                this.context?.logger.error('[PoolConnector] 消息处理器错误:', err);
            }
        });
    }
    
    /**
     * 发送消息到 Comm-Pool
     */
    async sendMessage(params: {
        content: string;
        receiverRole?: AgentRole | 'all';
        topic?: string;
        threadId?: string;
        isConclusion?: boolean;
        isSummary?: boolean;
        parentId?: number;
    }): Promise<{ success: boolean; threadId: string; message?: string }> {
        const topic = params.topic || this.config.defaultTopic!;
        
        try {
            const result = await this.client.sendMessage({
                topic,
                thread_id: params.threadId,
                sender_role: this.config.agentRole,
                receiver_role: params.receiverRole || 'all',
                content: params.content,
                is_conclusion: params.isConclusion,
                is_summary: params.isSummary,
                parent_id: params.parentId
            });
            
            if (result.success) {
                this.context?.logger.info(`[PoolConnector] 消息已发送到 ${topic}`);
            }
            
            return {
                success: result.success,
                threadId: result.thread_id,
                message: result.message
            };
        } catch (err) {
            this.context?.logger.error('[PoolConnector] 发送消息失败:', err);
            throw err;
        }
    }
    
    /**
     * 回复特定消息
     */
    async replyToMessage(parentId: number, content: string, options?: {
        receiverRole?: AgentRole;
        isConclusion?: boolean;
    }): Promise<{ success: boolean; threadId: string }> {
        // 获取父消息信息
        const parentMessage = await this.client.getMessage(parentId);
        
        return this.sendMessage({
            content,
            receiverRole: (options?.receiverRole || parentMessage.sender_role) as AgentRole | 'all',
            topic: parentMessage.topic,
            threadId: parentMessage.thread_id,
            parentId,
            isConclusion: options?.isConclusion
        });
    }
    
    /**
     * 发布结论
     */
    async publishConclusion(content: string, options?: {
        topic?: string;
        threadId?: string;
    }): Promise<{ success: boolean; threadId: string }> {
        return this.sendMessage({
            content,
            receiverRole: 'all',
            topic: options?.topic,
            threadId: options?.threadId,
            isConclusion: true
        });
    }
    
    /**
     * 获取线程历史（带 Token 压缩）
     */
    async getThreadHistory(threadId: string, options?: {
        limit?: number;
        compress?: boolean;
    }): Promise<{ messages: Message[]; compressed: boolean; tokenCount: number }> {
        let messages = await this.client.getMessages({
            thread_id: threadId,
            limit: options?.limit || 100
        });

        let compressed = false;
        let tokenCount = this.tokenCompressor.estimateTokens(messages);

        // 如果启用压缩且超过阈值
        if (options?.compress !== false && tokenCount > this.config.compressionThreshold!) {
            messages = this.tokenCompressor.compress(messages);
            compressed = true;
            tokenCount = this.tokenCompressor.estimateTokens(messages);
        }

        return { messages, compressed, tokenCount };
    }
    
    /**
     * 获取上下文窗口（用于 LLM 输入）
     */
    async getContextWindow(params: {
        topic?: string;
        threadId?: string;
        includeConclusions?: boolean;
    }): Promise<string> {
        const messages = await this.client.getMessages({
            topic: params.topic,
            thread_id: params.threadId,
            limit: 50
        });
        
        // 构建上下文文本
        let context = '';
        
        // 首先包含结论
        if (params.includeConclusions !== false) {
            const conclusions = messages.filter(m => m.is_conclusion);
            if (conclusions.length > 0) {
                context += '=== 已达成结论 ===\n';
                conclusions.forEach(c => {
                    context += `[${c.sender_role}] ${c.content}\n`;
                });
                context += '\n';
            }
        }
        
        // 然后包含最近的消息
        context += '=== 对话历史 ===\n';
        messages
            .filter(m => !m.is_conclusion)
            .slice(-20)
            .forEach(m => {
                context += `[${m.sender_role}] ${m.content}\n`;
            });
        
        // 如果超过 Token 限制，进行压缩
        const tokenCount = this.tokenCompressor.estimateTokenCount(context);
        if (tokenCount > this.config.maxContextTokens!) {
            context = this.tokenCompressor.compressText(context, this.config.maxContextTokens!);
        }
        
        return context;
    }
    
    /**
     * 订阅消息
     */
    onMessage(topic: string | '*', handler: (message: Message) => void): void {
        if (!this.messageHandlers.has(topic)) {
            this.messageHandlers.set(topic, []);
        }
        this.messageHandlers.get(topic)!.push(handler);
    }
    
    /**
     * 取消订阅
     */
    offMessage(topic: string | '*', handler: Function): void {
        const handlers = this.messageHandlers.get(topic);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    /**
     * 等待特定角色的回复
     */
    async waitForReply(params: {
        fromRole: AgentRole;
        topic?: string;
        threadId?: string;
        timeout?: number;
        checkInterval?: number;
    }): Promise<Message | null> {
        const { fromRole, topic, threadId, timeout = 30000, checkInterval = 1000 } = params;
        const startTime = Date.now();
        
        return new Promise((resolve) => {
            const check = async () => {
                // 检查是否超时
                if (Date.now() - startTime > timeout) {
                    resolve(null);
                    return;
                }
                
                // 获取最新消息
                const messages = await this.client.getMessages({
                    topic: topic || this.config.defaultTopic,
                    thread_id: threadId,
                    limit: 10
                });
                
                // 查找来自指定角色的最新消息
                const reply = messages
                    .reverse()
                    .find(m => m.sender_role === fromRole);
                
                if (reply) {
                    resolve(reply);
                } else {
                    setTimeout(check, checkInterval);
                }
            };
            
            check();
        });
    }
    
    /**
     * 创建新线程
     */
    async createThread(topic: string, initialMessage: string): Promise<{ threadId: string }> {
        const result = await this.sendMessage({
            content: initialMessage,
            topic,
            receiverRole: 'all'
        });
        
        return { threadId: result.threadId };
    }
    
    /**
     * 获取活跃线程列表
     */
    async getActiveThreads(topic?: string): Promise<Array<{
        threadId: string;
        messageCount: number;
        lastUpdate: string;
        hasConclusion: boolean;
    }>> {
        return this.threadManager.getThreads(topic || this.config.defaultTopic!);
    }
    
    /**
     * 提取线程结论
     */
    async extractConclusion(threadId: string): Promise<string | null> {
        return this.threadManager.getConclusion(threadId);
    }
    
    /**
     * 清理资源
     */
    async dispose(): Promise<void> {
        this.messageHandlers.clear();
        this.context?.logger.info('[PoolConnector] 已清理资源');
    }
}

// 导出子模块
export { PoolClient } from './client';
export { ThreadManager } from './thread-manager';
export { TokenCompressor } from './token-compressor';
export * from './types';
