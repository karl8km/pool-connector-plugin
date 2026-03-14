/**
 * Thread Manager - 线程管理器
 * 
 * 管理论坛线程的生命周期：
 * - 线程创建与归档
 * - 结论提取与跟踪
 * - 线程状态监控
 */

import type { PoolClient } from './client';
import type { ThreadInfo, Message, AgentRole } from './types';

export interface ThreadStats {
    threadId: string;
    messageCount: number;
    participantRoles: Set<string>;
    hasConclusion: boolean;
    conclusionContent: string | null;
    lastActivity: string;
    duration: number; // 线程持续时间（毫秒）
}

export class ThreadManager {
    private client: PoolClient;
    private cache: Map<string, ThreadInfo> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private readonly CACHE_TTL = 30000; // 30秒缓存
    
    constructor(client: PoolClient) {
        this.client = client;
    }
    
    /**
     * 获取线程列表（带缓存）
     */
    async getThreads(topic: string, limit: number = 50): Promise<Array<{
        threadId: string;
        messageCount: number;
        lastUpdate: string;
        hasConclusion: boolean;
    }>> {
        const cacheKey = `threads:${topic}`;
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            return cached as Array<{
                threadId: string;
                messageCount: number;
                lastUpdate: string;
                hasConclusion: boolean;
            }>;
        }
        
        const threads = await this.client.getThreads({ topic, limit });
        
        const result = threads.map(t => ({
            threadId: t.thread_id,
            messageCount: t.message_count,
            lastUpdate: t.last_update,
            hasConclusion: !!t.conclusion
        }));
        
        this.setCache(cacheKey, result);
        return result;
    }
    
    /**
     * 获取线程统计信息
     */
    async getThreadStats(threadId: string): Promise<ThreadStats> {
        const messages = await this.client.getMessages({ thread_id: threadId });
        
        if (messages.length === 0) {
            throw new Error(`Thread ${threadId} not found or empty`);
        }
        
        const participantRoles = new Set(messages.map(m => m.sender_role));
        const conclusion = messages.find(m => m.is_conclusion);
        const firstMessage = messages[0];
        const lastMessage = messages[messages.length - 1];
        
        const firstTime = new Date(firstMessage.timestamp).getTime();
        const lastTime = new Date(lastMessage.timestamp).getTime();
        
        return {
            threadId,
            messageCount: messages.length,
            participantRoles,
            hasConclusion: !!conclusion,
            conclusionContent: conclusion ? conclusion.content : null,
            lastActivity: lastMessage.timestamp,
            duration: lastTime - firstTime
        };
    }
    
    /**
     * 获取线程结论
     */
    async getConclusion(threadId: string): Promise<string | null> {
        const cacheKey = `conclusion:${threadId}`;
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            return cached as string | null;
        }
        
        const conclusion = await this.client.getConclusion(threadId);
        this.setCache(cacheKey, conclusion);
        
        return conclusion;
    }
    
    /**
     * 检查线程是否已解决（有结论）
     */
    async isResolved(threadId: string): Promise<boolean> {
        const conclusion = await this.getConclusion(threadId);
        return conclusion !== null;
    }
    
    /**
     * 查找包含特定关键词的线程
     */
    async searchThreads(topic: string, keyword: string): Promise<string[]> {
        const threads = await this.getThreads(topic);
        const matchingThreads: string[] = [];
        
        for (const thread of threads) {
            const messages = await this.client.getMessages({ 
                thread_id: thread.threadId,
                limit: 100
            });
            
            const hasMatch = messages.some(m => 
                m.content.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (hasMatch) {
                matchingThreads.push(thread.threadId);
            }
        }
        
        return matchingThreads;
    }
    
    /**
     * 获取线程参与者列表
     */
    async getParticipants(threadId: string): Promise<Array<{
        role: string;
        messageCount: number;
        firstMessage: string;
        lastMessage: string;
    }>> {
        const messages = await this.client.getMessages({ thread_id: threadId });
        
        const participantMap = new Map<string, {
            count: number;
            first: string;
            last: string;
        }>();
        
        messages.forEach(m => {
            const existing = participantMap.get(m.sender_role);
            
            if (existing) {
                existing.count++;
                existing.last = m.timestamp;
            } else {
                participantMap.set(m.sender_role, {
                    count: 1,
                    first: m.timestamp,
                    last: m.timestamp
                });
            }
        });
        
        return Array.from(participantMap.entries()).map(([role, stats]) => ({
            role,
            messageCount: stats.count,
            firstMessage: stats.first,
            lastMessage: stats.last
        }));
    }
    
    /**
     * 获取线程摘要（用于快速了解线程内容）
     */
    async getThreadSummary(threadId: string): Promise<{
        topic: string;
        totalMessages: number;
        participants: string[];
        keyPoints: string[];
        conclusion: string | null;
        status: 'active' | 'resolved' | 'stale';
    }> {
        const messages = await this.client.getMessages({ thread_id: threadId });
        
        if (messages.length === 0) {
            throw new Error(`Thread ${threadId} is empty`);
        }
        
        const firstMessage = messages[0];
        const participants = [...new Set(messages.map(m => m.sender_role))];
        const conclusion = messages.find(m => m.is_conclusion);
        
        // 提取关键点（这里使用简单的启发式方法）
        const keyPoints = this.extractKeyPoints(messages);
        
        // 判断线程状态
        const lastActivity = new Date(messages[messages.length - 1].timestamp);
        const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
        
        let status: 'active' | 'resolved' | 'stale';
        if (conclusion) {
            status = 'resolved';
        } else if (hoursSinceActivity > 24) {
            status = 'stale';
        } else {
            status = 'active';
        }
        
        return {
            topic: firstMessage.topic,
            totalMessages: messages.length,
            participants,
            keyPoints,
            conclusion: conclusion ? conclusion.content : null,
            status
        };
    }
    
    /**
     * 提取关键点（启发式方法）
     */
    private extractKeyPoints(messages: Message[]): string[] {
        const points: string[] = [];
        
        // 1. 包含问号的句子可能是问题
        messages.forEach(m => {
            const sentences = m.content.split(/[。！？.!?]/);
            sentences.forEach(s => {
                if (s.includes('?') || s.includes('？')) {
                    points.push(`问题: ${s.trim()}`);
                }
            });
        });
        
        // 2. 包含关键词的句子
        const keywords = ['建议', '方案', '决定', '结论', '重要', '注意'];
        messages.forEach(m => {
            keywords.forEach(kw => {
                if (m.content.includes(kw)) {
                    const idx = m.content.indexOf(kw);
                    const start = Math.max(0, idx - 20);
                    const end = Math.min(m.content.length, idx + 50);
                    points.push(`${kw}: ...${m.content.slice(start, end)}...`);
                }
            });
        });
        
        // 3. 摘要消息
        const summaries = messages.filter(m => m.is_summary);
        summaries.forEach(s => {
            points.push(`摘要: ${s.content}`);
        });
        
        // 去重并限制数量
        return [...new Set(points)].slice(0, 10);
    }
    
    /**
     * 获取活跃线程（最近有活动的）
     */
    async getActiveThreads(topic: string, hoursAgo: number = 24): Promise<Array<{
        threadId: string;
        lastActivity: string;
        messageCount: number;
    }>> {
        const threads = await this.getThreads(topic);
        const cutoffTime = Date.now() - (hoursAgo * 60 * 60 * 1000);
        
        return threads
            .filter(t => new Date(t.lastUpdate).getTime() > cutoffTime)
            .map(t => ({
                threadId: t.threadId,
                lastActivity: t.lastUpdate,
                messageCount: t.messageCount
            }));
    }
    
    /**
     * 获取未解决的线程
     */
    async getUnresolvedThreads(topic: string): Promise<Array<{
        threadId: string;
        messageCount: number;
        lastUpdate: string;
    }>> {
        const threads = await this.getThreads(topic);
        
        return threads
            .filter(t => !t.hasConclusion)
            .map(t => ({
                threadId: t.threadId,
                messageCount: t.messageCount,
                lastUpdate: t.lastUpdate
            }));
    }
    
    /**
     * 合并多个线程的结论
     */
    async mergeConclusions(threadIds: string[]): Promise<string> {
        const conclusions: string[] = [];
        
        for (const threadId of threadIds) {
            const conclusion = await this.getConclusion(threadId);
            if (conclusion) {
                conclusions.push(conclusion);
            }
        }
        
        if (conclusions.length === 0) {
            return '暂无结论';
        }
        
        return conclusions.join('\n\n---\n\n');
    }
    
    /**
     * 清理缓存
     */
    clearCache(): void {
        this.cache.clear();
        this.cacheExpiry.clear();
    }
    
    /**
     * 从缓存获取
     */
    private getFromCache(key: string): any | null {
        const expiry = this.cacheExpiry.get(key);
        
        if (expiry && Date.now() < expiry) {
            return this.cache.get(key) || null;
        }
        
        return null;
    }
    
    /**
     * 设置缓存
     */
    private setCache(key: string, value: any): void {
        this.cache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
    }
}
