/**
 * Pool Client - Comm-Pool API 客户端
 * 
 * 封装与 Comm-Pool 后端的所有 HTTP API 通信
 */

import type {
    PoolClientConfig,
    SendMessageRequest,
    SendMessageResponse,
    GetMessagesRequest,
    GetMessagesResponse,
    GetThreadsRequest,
    GetThreadsResponse,
    Message,
    ThreadInfo
} from './types';

export class PoolClient {
    private config: Required<PoolClientConfig>;
    
    constructor(config: PoolClientConfig) {
        this.config = {
            timeout: 10000,
            retries: 3,
            ...config
        };
    }
    
    /**
     * 发送 HTTP 请求（带重试机制）
     */
    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.config.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt < this.config.retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
                
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
                
                return await response.json() as T;
            } catch (err) {
                lastError = err as Error;
                
                // 如果不是最后一次尝试，等待后重试
                if (attempt < this.config.retries - 1) {
                    const delay = Math.pow(2, attempt) * 1000; // 指数退避
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError || new Error('Request failed after retries');
    }
    
    /**
     * 发送消息到 Comm-Pool
     */
    async sendMessage(params: SendMessageRequest): Promise<SendMessageResponse> {
        return this.request<SendMessageResponse>('/api/message', {
            method: 'POST',
            body: JSON.stringify(params)
        });
    }
    
    /**
     * 获取消息列表
     */
    async getMessages(params: GetMessagesRequest = {}): Promise<Message[]> {
        const queryParams = new URLSearchParams();
        
        if (params.topic) queryParams.append('topic', params.topic);
        if (params.thread_id) queryParams.append('thread_id', params.thread_id);
        if (params.limit) queryParams.append('limit', params.limit.toString());
        
        const query = queryParams.toString();
        const endpoint = `/api/messages${query ? '?' + query : ''}`;
        
        const response = await this.request<GetMessagesResponse>(endpoint);
        return response.messages;
    }
    
    /**
     * 获取单条消息
     */
    async getMessage(id: number): Promise<Message> {
        const messages = await this.getMessages({});
        const message = messages.find(m => m.id === id);
        
        if (!message) {
            throw new Error(`Message ${id} not found`);
        }
        
        return message;
    }
    
    /**
     * 获取线程列表
     */
    async getThreads(params: GetThreadsRequest): Promise<ThreadInfo[]> {
        const queryParams = new URLSearchParams();
        
        queryParams.append('topic', params.topic);
        if (params.limit) queryParams.append('limit', params.limit.toString());
        
        const endpoint = `/api/threads?${queryParams.toString()}`;
        
        const response = await this.request<GetThreadsResponse>(endpoint);
        return response.threads;
    }
    
    /**
     * 获取所有 Topics
     */
    async getTopics(): Promise<Array<{ topic: string; last_update: string; msg_count: number }>> {
        const response = await this.request<{ topics: Array<{ topic: string; last_update: string; msg_count: number }> }>('/api/topics');
        return response.topics;
    }
    
    /**
     * 创建新 Topic
     */
    async createTopic(topic: string): Promise<{ success: boolean; message: string }> {
        return this.request('/api/topic', {
            method: 'POST',
            body: JSON.stringify({ topic })
        });
    }
    
    /**
     * 删除 Topic
     */
    async deleteTopic(topic: string): Promise<{ success: boolean; message: string }> {
        return this.request('/api/topic', {
            method: 'DELETE',
            body: JSON.stringify({ topic })
        });
    }
    
    /**
     * 标记消息为结论
     */
    async markAsConclusion(messageId: number, isConclusion: boolean = true): Promise<{ success: boolean }> {
        return this.request(`/api/message/${messageId}/conclusion`, {
            method: 'PATCH',
            body: JSON.stringify({ is_conclusion: isConclusion })
        });
    }
    
    /**
     * 标记消息为摘要
     */
    async markAsSummary(messageId: number, isSummary: boolean = true): Promise<{ success: boolean }> {
        return this.request(`/api/message/${messageId}/summary`, {
            method: 'PATCH',
            body: JSON.stringify({ is_summary: isSummary })
        });
    }
    
    /**
     * 获取线程中的结论
     */
    async getConclusion(threadId: string): Promise<string | null> {
        const messages = await this.getMessages({ thread_id: threadId });
        const conclusion = messages.find(m => m.is_conclusion);
        return conclusion ? conclusion.content : null;
    }
    
    /**
     * 检查线程是否有结论
     */
    async hasConclusion(threadId: string): Promise<boolean> {
        const conclusion = await this.getConclusion(threadId);
        return conclusion !== null;
    }
    
    /**
     * 获取线程消息数量
     */
    async getThreadMessageCount(threadId: string): Promise<number> {
        const messages = await this.getMessages({ thread_id: threadId });
        return messages.length;
    }
    
    /**
     * 获取线程最新活动时间
     */
    async getThreadLastUpdate(threadId: string): Promise<string | null> {
        const messages = await this.getMessages({ thread_id: threadId });
        
        if (messages.length === 0) {
            return null;
        }
        
        const lastMessage = messages[messages.length - 1];
        return lastMessage.timestamp;
    }
    
    /**
     * 批量获取消息
     */
    async getMessagesBatch(messageIds: number[]): Promise<Message[]> {
        const allMessages = await this.getMessages({ limit: 1000 });
        return allMessages.filter(m => messageIds.includes(m.id));
    }
    
    /**
     * 获取线程的完整对话链（包含父消息）
     */
    async getMessageChain(messageId: number): Promise<Message[]> {
        const chain: Message[] = [];
        const visited = new Set<number>();
        
        let currentId: number | null = messageId;
        
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            
            try {
                const message = await this.getMessage(currentId);
                chain.unshift(message);
                currentId = message.parent_id;
            } catch {
                break;
            }
        }
        
        return chain;
    }
}
