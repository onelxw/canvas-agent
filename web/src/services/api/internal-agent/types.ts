import type { InternalAgentModelEvent, InternalAgentProtocol, InternalAgentToolCall, InternalAgentToolDefinition } from "@/lib/internal-agent/types";

export type InternalAgentTransportMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
    toolCalls?: InternalAgentToolCall[];
};

export type InternalAgentModelRequest = {
    protocol: InternalAgentProtocol;
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: InternalAgentTransportMessage[];
    tools: InternalAgentToolDefinition[];
    signal?: AbortSignal;
};

export type InternalAgentModelStream = AsyncGenerator<InternalAgentModelEvent, void, void>;
