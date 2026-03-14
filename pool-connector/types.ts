/**
 * Pool Connector 类型定义
 * 
 * 定义 OpenClaw 插件接口和 Comm-Pool 消息类型
 */

// OpenClaw 插件接口
export interface OpenClawPlugin {
    name: string;
    version: string;
    initialize(context: PluginContext): Promise<void>;
    dispose?(): Promise<void>;
}

// 插件上下文
export interface PluginContext {
    logger: Logger;
    config: Record<string, any>;
    getAgent(role: AgentRole): Agent | null;
}

// 日志接口
export interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
}

// Agent 角色类型
export type AgentRole = 'GM' | 'PM' | 'TE' | 'SE' | 'System';

// Agent 接口
export interface Agent {
    role: AgentRole;
    name: string;
    sendMessage(message: string): Promise<void>;
}

// Comm-Pool 消息结构
export interface Message {
    id: number;
    topic: string;
    thread_id: string;
    sender_role: AgentRole | string;
    receiver_role: AgentRole | 'all' | string;
    content: string;
    is_conclusion: number | boolean;
    is_summary: number | boolean;
    parent_id: number | null;
    timestamp: string;
}

// API 请求/响应类型
export interface SendMessageRequest {
    topic: string;
    thread_id?: string;
    sender_role: string;
    receiver_role: string;
    content: string;
    is_conclusion?: boolean;
    is_summary?: boolean;
    parent_id?: number;
}

export interface SendMessageResponse {
    success: boolean;
    message?: string;
    thread_id: string;
}

export interface GetMessagesRequest {
    topic?: string;
    thread_id?: string;
    limit?: number;
}

export interface GetMessagesResponse {
    messages: Message[];
}

export interface GetThreadsRequest {
    topic: string;
    limit?: number;
}

export interface ThreadInfo {
    thread_id: string;
    topic: string;
    message_count: number;
    last_update: string;
    conclusion: string | null;
}

export interface GetThreadsResponse {
    threads: ThreadInfo[];
}

// WebSocket 消息类型
export interface WebSocketMessage {
    type: 'message' | 'ping' | 'pong' | 'system';
    payload?: any;
    timestamp: string;
}

// Token 压缩配置
export interface TokenCompressorConfig {
    maxTokens: number;
    threshold: number;
    preserveRecent?: number;
}

// 线程管理配置
export interface ThreadManagerConfig {
    autoArchiveAfter?: number; // 自动归档时间（毫秒）
    maxThreadsPerTopic?: number;
}

// Pool Client 配置
export interface PoolClientConfig {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
    retries?: number;
}

// 消息过滤器
export interface MessageFilter {
    senderRole?: AgentRole;
    receiverRole?: AgentRole | 'all';
    isConclusion?: boolean;
    isSummary?: boolean;
    since?: Date;
    until?: Date;
}

// 上下文窗口配置
export interface ContextWindowConfig {
    maxTokens: number;
    includeConclusions: boolean;
    includeSummaries: boolean;
    messageLimit: number;
}

// 插件事件类型
export type PluginEvent = 
    | { type: 'message_received'; message: Message }
    | { type: 'message_sent'; message: Message }
    | { type: 'conclusion_published'; threadId: string; content: string }
    | { type: 'thread_created'; threadId: string; topic: string }
    | { type: 'error'; error: Error };

// 事件处理器
export type EventHandler<T extends PluginEvent> = (event: T) => void | Promise<void>;
