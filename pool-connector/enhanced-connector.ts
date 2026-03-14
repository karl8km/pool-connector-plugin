/**
 * Enhanced Pool Connector - 多项目协作增强版
 * 
 * 支持：
 * - 项目上下文管理
 * - Agent 实例标识
 * - 指令类型区分
 * - 回复追踪
 * - 超时处理
 */

import { PoolConnector, PoolConnectorConfig } from './index';
import type { Message, AgentRole } from './types';

// 消息类型
export type EnhancedMessageType = 
  | 'command'        // 指令：需要执行的任务
  | 'response'       // 回复：对指令的响应
  | 'question'       // 提问：需要回答的问题
  | 'answer'         // 回答：对问题的回复
  | 'notification'   // 通知：纯信息，无需回复
  | 'conclusion'     // 结论：已达成的一致
  | 'summary'        // 摘要：讨论总结
  | 'status_update'; // 状态更新：Agent状态变更

// 指令类型
export type CommandType =
  | 'evaluate'       // 评估：技术可行性、工作量等
  | 'implement'      // 实现：编码开发
  | 'review'         // 审查：代码审查、方案审查
  | 'decide'         // 决策：做出决定
  | 'plan'           // 规划：制定计划
  | 'research'       // 调研：技术调研
  | 'test'           // 测试：功能测试
  | 'deploy'         // 部署：上线部署
  | 'analyze'        // 分析：问题分析
  | 'design';        // 设计：架构设计

// Agent 状态
export type AgentStatus = 'awake' | 'sleeping' | 'busy' | 'offline';

// 结构化消息内容
export interface StructuredContent {
  version: '2.0';
  project: {
    id: string;
    name: string;
  };
  agent: {
    role: AgentRole;
    instance_id: string;
    status: AgentStatus;
  };
  message: {
    type: EnhancedMessageType;
    command_type?: CommandType;
    task_id?: string;
    title?: string;
    body: string;
    requirements?: string[];
    constraints?: string[];
    deliverables?: string[];
  };
  target?: {
    role: AgentRole;
    instance_id?: string;
  };
  workflow: {
    requires_response: boolean;
    response_deadline?: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    tags?: string[];
  };
  context?: {
    refs?: string[];
    parent_task_id?: string;
    related_projects?: string[];
  };
  metadata?: Record<string, any>;
}

// 指令消息
export interface CommandMessage {
  projectId: string;
  projectName: string;
  commandType: CommandType;
  taskId: string;
  title: string;
  body: string;
  requirements?: string[];
  constraints?: string[];
  deliverables?: string[];
  targetRole: AgentRole;
  targetInstanceId?: string;
  requiresResponse: boolean;
  responseDeadline?: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  parentTaskId?: string;
  contextRefs?: string[];
}

// 增强配置
export interface EnhancedConnectorConfig extends PoolConnectorConfig {
  instanceId: string;           // Agent 实例ID（如 PM-01）
  currentProjectId?: string;    // 当前项目ID
}

// 待处理指令
export interface PendingCommand {
  messageId: number;
  projectId: string;
  taskId: string;
  commandType: CommandType;
  title: string;
  body: string;
  senderRole: AgentRole;
  senderInstanceId: string;
  receivedAt: Date;
  deadline?: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export class EnhancedPoolConnector extends PoolConnector {
  private instanceId: string;
  private currentProjectId: string | null = null;
  private agentStatus: AgentStatus = 'awake';
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private commandHandlers: Map<CommandType, Function> = new Map();
  private responsePromises: Map<string, { resolve: Function; reject: Function; timeout: any }> = new Map();

  constructor(config: EnhancedConnectorConfig) {
    super(config);
    this.instanceId = config.instanceId;
    this.currentProjectId = config.currentProjectId || null;
  }

  /**
   * 发送结构化指令
   */
  async sendCommand(command: CommandMessage): Promise<{ success: boolean; threadId: string; messageId?: number }> {
    const structuredContent: StructuredContent = {
      version: '2.0',
      project: {
        id: command.projectId,
        name: command.projectName
      },
      agent: {
        role: this.config.agentRole,
        instance_id: this.instanceId,
        status: this.agentStatus
      },
      message: {
        type: 'command',
        command_type: command.commandType,
        task_id: command.taskId,
        title: command.title,
        body: command.body,
        requirements: command.requirements,
        constraints: command.constraints,
        deliverables: command.deliverables
      },
      target: {
        role: command.targetRole,
        instance_id: command.targetInstanceId
      },
      workflow: {
        requires_response: command.requiresResponse,
        response_deadline: command.responseDeadline?.toISOString(),
        priority: command.priority
      },
      context: {
        parent_task_id: command.parentTaskId,
        refs: command.contextRefs
      }
    };

    const result = await this.sendMessage({
      topic: `${command.projectId}_${command.projectName}`,
      content: JSON.stringify(structuredContent),
      receiverRole: (command.targetInstanceId || command.targetRole) as any,
      isSummary: command.priority === 'high' || command.priority === 'urgent'
    });

    return {
      success: result.success,
      threadId: result.threadId,
      messageId: (result as any).messageId
    };
  }

  /**
   * 发送结构化回复
   */
  async sendResponse(params: {
    projectId: string;
    projectName: string;
    parentMessageId: number;
    taskId: string;
    body: string;
    status: 'completed' | 'in_progress' | 'blocked' | 'failed';
    deliverables?: string[];
    nextSteps?: string[];
    toRole: AgentRole;
    toInstanceId?: string;
  }): Promise<{ success: boolean; threadId: string }> {
    const structuredContent: StructuredContent = {
      version: '2.0',
      project: {
        id: params.projectId,
        name: params.projectName
      },
      agent: {
        role: this.config.agentRole,
        instance_id: this.instanceId,
        status: this.agentStatus
      },
      message: {
        type: 'response',
        task_id: params.taskId,
        body: params.body
      },
      target: {
        role: params.toRole,
        instance_id: params.toInstanceId
      },
      workflow: {
        requires_response: false,
        priority: 'medium'
      },
      metadata: {
        status: params.status,
        deliverables: params.deliverables,
        next_steps: params.nextSteps
      }
    };

    return this.replyToMessage(params.parentMessageId, JSON.stringify(structuredContent), {
      receiverRole: params.toRole
    });
  }

  /**
   * 发送状态更新
   */
  async sendStatusUpdate(projectId: string, projectName: string, status: AgentStatus, details?: string): Promise<void> {
    this.agentStatus = status;

    const structuredContent: StructuredContent = {
      version: '2.0',
      project: {
        id: projectId,
        name: projectName
      },
      agent: {
        role: this.config.agentRole,
        instance_id: this.instanceId,
        status: status
      },
      message: {
        type: 'status_update',
        body: details || `${this.instanceId} 状态变更为: ${status}`
      },
      workflow: {
        requires_response: false,
        priority: 'low'
      }
    };

    await this.sendMessage({
      topic: `${projectId}_${projectName}`,
      content: JSON.stringify(structuredContent),
      receiverRole: 'all'
    });
  }

  /**
   * 注册指令处理器
   */
  onCommand(commandType: CommandType, handler: (command: PendingCommand) => Promise<void>): void {
    this.commandHandlers.set(commandType, handler);
  }

  /**
   * 等待特定指令的回复
   */
  async waitForCommandResponse(taskId: string, timeout: number = 60000): Promise<StructuredContent | null> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.responsePromises.delete(taskId);
        resolve(null);
      }, timeout);

      this.responsePromises.set(taskId, {
        resolve: (content: StructuredContent) => {
          clearTimeout(timeoutId);
          this.responsePromises.delete(taskId);
          resolve(content);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          this.responsePromises.delete(taskId);
          reject(error);
        },
        timeout: timeoutId as any
      });
    });
  }

  /**
   * 获取待处理指令列表
   */
  getPendingCommands(): PendingCommand[] {
    return Array.from(this.pendingCommands.values())
      .sort((a, b) => {
        // 按优先级和截止时间排序
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        if (a.deadline && b.deadline) {
          return a.deadline.getTime() - b.deadline.getTime();
        }
        return 0;
      });
  }

  /**
   * 切换当前项目
   */
  switchProject(projectId: string): void {
    this.currentProjectId = projectId;
    this.context?.logger.info(`[EnhancedConnector] 切换到项目: ${projectId}`);
  }

  /**
   * 获取当前项目上下文
   */
  async getCurrentProjectContext(): Promise<{
    projectId: string;
    recentMessages: Message[];
    pendingCommands: PendingCommand[];
    activeAgents: Array<{ role: AgentRole; instanceId: string; status: AgentStatus }>;
  } | null> {
    if (!this.currentProjectId) {
      return null;
    }

    const messages = await this.client.getMessages({
      limit: 50
    });

    // 过滤当前项目的消息
    const projectMessages = messages.filter(m => {
      try {
        const content: StructuredContent = JSON.parse(m.content);
        return content.project?.id === this.currentProjectId;
      } catch {
        return false;
      }
    });

    // 提取活跃 Agent
    const agentMap = new Map<string, { role: AgentRole; instanceId: string; status: AgentStatus }>();
    projectMessages.forEach(m => {
      try {
        const content: StructuredContent = JSON.parse(m.content);
        const key = `${content.agent.role}-${content.agent.instance_id}`;
        agentMap.set(key, {
          role: content.agent.role,
          instanceId: content.agent.instance_id,
          status: content.agent.status
        });
      } catch {}
    });

    return {
      projectId: this.currentProjectId,
      recentMessages: projectMessages,
      pendingCommands: this.getPendingCommands().filter(c => c.projectId === this.currentProjectId),
      activeAgents: Array.from(agentMap.values())
    };
  }

  /**
   * 解析结构化消息
   */
  parseStructuredMessage(message: Message): StructuredContent | null {
    try {
      return JSON.parse(message.content);
    } catch {
      return null;
    }
  }

  /**
   * 处理接收到的消息（重写父类方法）
   */
  protected handleIncomingMessage(message: Message): void {
    super.handleIncomingMessage(message);

    // 解析结构化内容
    const structured = this.parseStructuredMessage(message);
    if (!structured) return;

    // 处理指令
    if (structured.message.type === 'command') {
      this.handleCommandMessage(message, structured);
    }

    // 处理回复
    if (structured.message.type === 'response') {
      this.handleResponseMessage(structured);
    }

    // 处理状态更新
    if (structured.message.type === 'status_update') {
      this.context?.logger.info(
        `[EnhancedConnector] Agent ${structured.agent.instance_id} 状态: ${structured.agent.status}`
      );
    }
  }

  /**
   * 处理指令消息
   */
  private handleCommandMessage(message: Message, structured: StructuredContent): void {
    // 检查是否是发给自己的
    const targetRole = structured.target?.role;
    const targetInstance = structured.target?.instance_id;

    if (targetRole && targetRole !== this.config.agentRole && (targetRole as any) !== 'all') {
      return;
    }

    if (targetInstance && targetInstance !== this.instanceId) {
      return;
    }

    // 创建待处理指令
    const command: PendingCommand = {
      messageId: message.id,
      projectId: structured.project.id,
      taskId: structured.message.task_id || '',
      commandType: structured.message.command_type!,
      title: structured.message.title || '',
      body: structured.message.body,
      senderRole: structured.agent.role,
      senderInstanceId: structured.agent.instance_id,
      receivedAt: new Date(),
      deadline: structured.workflow.response_deadline 
        ? new Date(structured.workflow.response_deadline) 
        : undefined,
      priority: structured.workflow.priority
    };

    this.pendingCommands.set(command.taskId, command);

    // 调用注册的处理器
    const handler = this.commandHandlers.get(command.commandType);
    if (handler) {
      handler(command).catch((err: Error) => {
        this.context?.logger.error('[EnhancedConnector] 指令处理失败:', err);
      });
    }

    this.context?.logger.info(
      `[EnhancedConnector] 收到指令 [${command.commandType}]: ${command.title}`
    );
  }

  /**
   * 处理回复消息
   */
  private handleResponseMessage(structured: StructuredContent): void {
    const taskId = structured.message.task_id;
    if (!taskId) return;

    // 从待处理列表中移除
    this.pendingCommands.delete(taskId);

    // 触发等待的 Promise
    const promise = this.responsePromises.get(taskId);
    if (promise) {
      promise.resolve(structured);
    }
  }

  /**
   * 完成指令
   */
  async completeCommand(taskId: string, response: string, deliverables?: string[]): Promise<void> {
    const command = this.pendingCommands.get(taskId);
    if (!command) {
      throw new Error(`未找到指令: ${taskId}`);
    }

    await this.sendResponse({
      projectId: command.projectId,
      projectName: command.projectId,
      parentMessageId: command.messageId,
      taskId: taskId,
      body: response,
      status: 'completed',
      deliverables: deliverables,
      toRole: command.senderRole,
      toInstanceId: command.senderInstanceId
    });

    this.pendingCommands.delete(taskId);
  }
}

// 导出
export * from './index';
