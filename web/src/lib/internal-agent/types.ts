export type InternalAgentProtocol = "openai-responses" | "openai-chat-completions";
export type InternalAgentPermission = "read" | "canvas_write" | "generation";

export type InternalAgentPermissionSettings = {
    read: boolean;
    canvas_write: boolean;
    generation: boolean;
    autoConfirmCanvasWrite: boolean;
    autoConfirmGeneration: boolean;
};

export type InternalAgentLimits = {
    maxModelRounds: number;
    maxToolCallsPerRound: number;
    maxTotalToolCalls: number;
    maxCanvasOps: number;
    maxAffectedNodes: number;
    maxContextMessages: number;
    maxContextChars: number;
    maxToolResultChars: number;
    connectionTestTimeoutMs: number;
};

export const DEFAULT_INTERNAL_AGENT_LIMITS: InternalAgentLimits = {
    maxModelRounds: 12,
    maxToolCallsPerRound: 8,
    maxTotalToolCalls: 32,
    maxCanvasOps: 50,
    maxAffectedNodes: 50,
    maxContextMessages: 80,
    maxContextChars: 120_000,
    maxToolResultChars: 20_000,
    connectionTestTimeoutMs: 30_000,
};

export const DEFAULT_INTERNAL_AGENT_PERMISSIONS: InternalAgentPermissionSettings = {
    read: true,
    canvas_write: true,
    generation: true,
    autoConfirmCanvasWrite: false,
    autoConfirmGeneration: false,
};

export type InternalAgentToolCall = {
    id: string;
    name: string;
    arguments: string;
};

export type InternalAgentUsage = {
    inputTokens?: number;
    cachedTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
};

export type InternalAgentModelEvent =
    | { type: "text_delta"; delta: string }
    | { type: "reasoning_delta"; delta: string }
    | { type: "tool_call"; call: InternalAgentToolCall }
    | { type: "usage"; usage: InternalAgentUsage }
    | { type: "done"; responseId?: string }
    | { type: "error"; message: string; code?: string };

export type InternalAgentMessage = {
    id: string;
    itemId: string;
    threadId: string;
    turnId: string;
    role: "system" | "user" | "assistant" | "tool" | "error";
    text: string;
    toolCallId?: string;
    toolName?: string;
    createdAt: string;
};

export type InternalAgentToolDefinition = {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
};

export type InternalAgentCanvasSnapshot = {
    projectId: string;
    revision: number;
    title: string;
    nodes: unknown[];
    connections: unknown[];
    selectedNodeIds: string[];
    viewport: { x: number; y: number; k: number };
};
