/**
 * Token Compressor - Token 压缩器
 * 
 * 管理 LLM 上下文窗口的 Token 限制：
 * - Token 估算
 * - 智能压缩策略
 * - 保留关键信息
 */

import type { Message } from './types';

export interface TokenCompressorConfig {
    maxTokens: number;
    threshold: number;
    preserveRecent?: number; // 保留最近 N 条消息不压缩
}

export class TokenCompressor {
    private config: Required<TokenCompressorConfig>;
    
    // 中文字符平均 Token 数（基于常见 LLM 的估算）
    private readonly CHINESE_CHARS_PER_TOKEN = 1.5;
    // 英文单词平均 Token 数
    private readonly ENGLISH_WORDS_PER_TOKEN = 0.75;
    
    constructor(config: TokenCompressorConfig) {
        this.config = {
            preserveRecent: 5,
            ...config
        };
    }
    
    /**
     * 估算文本的 Token 数量
     * 
     * 使用简单的启发式方法：
     * - 中文字符：1.5 字符/Token
     * - 英文单词：0.75 单词/Token
     * - 标点符号和空格：单独计算
     */
    estimateTokenCount(text: string): number {
        // 统计中文字符
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        
        // 统计英文单词
        const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
        
        // 统计其他字符（标点、数字、空格等）
        const otherChars = text.length - chineseChars - englishWords;
        
        // 计算 Token 数
        const chineseTokens = chineseChars / this.CHINESE_CHARS_PER_TOKEN;
        const englishTokens = englishWords / this.ENGLISH_WORDS_PER_TOKEN;
        const otherTokens = otherChars / 2; // 其他字符约 2 字符/Token
        
        return Math.ceil(chineseTokens + englishTokens + otherTokens);
    }
    
    /**
     * 估算消息列表的 Token 数
     */
    estimateTokens(messages: Message[]): number {
        let total = 0;
        
        for (const msg of messages) {
            // 元数据开销（role, timestamp 等）
            total += 20;
            // 内容 Token
            total += this.estimateTokenCount(msg.content);
        }
        
        return total;
    }
    
    /**
     * 压缩消息列表
     * 
     * 策略：
     * 1. 保留最近 N 条消息
     * 2. 保留所有结论和摘要
     * 3. 对中间消息进行摘要或删除
     */
    compress(messages: Message[]): Message[] {
        if (messages.length <= this.config.preserveRecent) {
            return messages;
        }
        
        const tokenCount = this.estimateTokens(messages);
        
        if (tokenCount <= this.config.threshold) {
            return messages;
        }
        
        // 分离需要保留的消息
        const conclusions = messages.filter(m => m.is_conclusion);
        const summaries = messages.filter(m => m.is_summary && !m.is_conclusion);
        const recentMessages = messages.slice(-this.config.preserveRecent);
        const otherMessages = messages.slice(0, -this.config.preserveRecent)
            .filter(m => !m.is_conclusion && !m.is_summary);
        
        // 如果其他消息太多，进行压缩
        let compressedOthers: Message[] = [];
        
        if (otherMessages.length > 10) {
            // 策略：保留每 N 条消息中的一条
            const step = Math.ceil(otherMessages.length / 10);
            compressedOthers = otherMessages.filter((_, idx) => idx % step === 0);
            
            // 添加压缩标记
            if (otherMessages.length > compressedOthers.length) {
                compressedOthers.push(this.createCompressionMarker(
                    otherMessages.length - compressedOthers.length
                ));
            }
        } else {
            compressedOthers = otherMessages;
        }
        
        // 合并所有消息，保持时间顺序
        const result = [
            ...compressedOthers,
            ...summaries,
            ...conclusions,
            ...recentMessages
        ].sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // 去重
        const seen = new Set<number>();
        return result.filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });
    }
    
    /**
     * 创建压缩标记消息
     */
    private createCompressionMarker(skippedCount: number): Message {
        return {
            id: -1,
            topic: '',
            thread_id: '',
            sender_role: 'System',
            receiver_role: 'all',
            content: `[... ${skippedCount} 条消息已压缩以节省 Token ...]`,
            is_conclusion: false,
            is_summary: true,
            parent_id: null,
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * 压缩文本到指定 Token 限制
     */
    compressText(text: string, maxTokens: number): string {
        const currentTokens = this.estimateTokenCount(text);
        
        if (currentTokens <= maxTokens) {
            return text;
        }
        
        // 策略：保留开头和结尾，中间用省略号
        const lines = text.split('\n');
        
        if (lines.length <= 10) {
            // 行数较少，直接截断
            const ratio = maxTokens / currentTokens;
            const keepLength = Math.floor(text.length * ratio);
            return text.slice(0, keepLength) + '\n\n[...内容已截断...]';
        }
        
        // 保留开头和结尾各 30%
        const headLines = Math.floor(lines.length * 0.3);
        const tailLines = Math.floor(lines.length * 0.3);
        
        const head = lines.slice(0, headLines).join('\n');
        const tail = lines.slice(-tailLines).join('\n');
        
        return `${head}\n\n[... ${lines.length - headLines - tailLines} 行已省略 ...]\n\n${tail}`;
    }
    
    /**
     * 智能摘要消息列表
     * 
     * 生成一个简短的摘要，保留关键信息
     */
    generateSummary(messages: Message[]): string {
        if (messages.length === 0) {
            return '';
        }
        
        const participants = [...new Set(messages.map(m => m.sender_role))];
        const conclusions = messages.filter(m => m.is_conclusion);
        const questions = this.extractQuestions(messages);
        
        let summary = `对话摘要 (${messages.length} 条消息)\n`;
        summary += `参与者: ${participants.join(', ')}\n`;
        
        if (conclusions.length > 0) {
            summary += `\n结论:\n`;
            conclusions.forEach(c => {
                summary += `- ${c.content.slice(0, 100)}${c.content.length > 100 ? '...' : ''}\n`;
            });
        }
        
        if (questions.length > 0) {
            summary += `\n待解决问题:\n`;
            questions.slice(0, 3).forEach(q => {
                summary += `- ${q.slice(0, 80)}${q.length > 80 ? '...' : ''}\n`;
            });
        }
        
        return summary;
    }
    
    /**
     * 提取问题
     */
    private extractQuestions(messages: Message[]): string[] {
        const questions: string[] = [];
        
        messages.forEach(m => {
            // 查找包含问号的句子
            const sentences = m.content.split(/[。！？.!?]/);
            sentences.forEach(s => {
                if (s.includes('?') || s.includes('？')) {
                    questions.push(s.trim());
                }
            });
        });
        
        return [...new Set(questions)];
    }
    
    /**
     * 构建优化的上下文窗口
     * 
     * 为 LLM 输入构建最优的上下文格式
     */
    buildContextWindow(
        messages: Message[],
        options?: {
            includeHeader?: boolean;
            format?: 'plain' | 'structured' | 'markdown';
        }
    ): string {
        const opts = {
            includeHeader: true,
            format: 'structured' as const,
            ...options
        };
        
        let context = '';
        
        if (opts.includeHeader) {
            context += `=== 对话上下文 (${messages.length} 条消息) ===\n\n`;
        }
        
        switch (opts.format) {
            case 'plain':
                context += messages.map(m => m.content).join('\n\n');
                break;
                
            case 'structured':
                messages.forEach(m => {
                    context += `[${m.sender_role}] ${m.content}\n\n`;
                });
                break;
                
            case 'markdown':
                messages.forEach(m => {
                    const roleEmoji = this.getRoleEmoji(m.sender_role);
                    context += `${roleEmoji} **${m.sender_role}**\n${m.content}\n\n`;
                });
                break;
        }
        
        return context.trim();
    }
    
    /**
     * 获取角色对应的 Emoji
     */
    private getRoleEmoji(role: string): string {
        const emojiMap: Record<string, string> = {
            'GM': '👑',
            'PM': '📋',
            'TE': '🔧',
            'SE': '💻',
            'System': '⚙️'
        };
        
        return emojiMap[role] || '👤';
    }
    
    /**
     * 检查是否需要压缩
     */
    needsCompression(messages: Message[]): boolean {
        return this.estimateTokens(messages) > this.config.threshold;
    }
    
    /**
     * 获取压缩统计
     */
    getCompressionStats(original: Message[], compressed: Message[]): {
        originalCount: number;
        compressedCount: number;
        reductionRatio: number;
        originalTokens: number;
        compressedTokens: number;
    } {
        const originalTokens = this.estimateTokens(original);
        const compressedTokens = this.estimateTokens(compressed);
        
        return {
            originalCount: original.length,
            compressedCount: compressed.length,
            reductionRatio: (original.length - compressed.length) / original.length,
            originalTokens,
            compressedTokens
        };
    }
}
