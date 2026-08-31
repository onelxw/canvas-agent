import type { InternalAgentModelEvent } from "@/lib/internal-agent/types";
import { streamChatCompletionsAgent } from "./chat-completions";
import { streamResponsesAgent } from "./responses";
import type { InternalAgentModelRequest } from "./types";

export type { InternalAgentModelRequest, InternalAgentTransportMessage } from "./types";

export function streamInternalAgentModel(request: InternalAgentModelRequest): AsyncGenerator<InternalAgentModelEvent> {
    if (request.protocol === "openai-responses") return streamResponsesAgent(request);
    if (request.protocol === "openai-chat-completions") return streamChatCompletionsAgent(request);
    throw new Error(`不支持的 Agent 协议：${String(request.protocol)}`);
}

export async function testInternalAgentConnection(request: Omit<InternalAgentModelRequest, "messages" | "tools" | "signal">, timeoutMs: number) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        for await (const event of streamInternalAgentModel({
            ...request,
            messages: [{ role: "user", content: "Reply with OK." }],
            tools: [],
            signal: controller.signal,
        })) {
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "text_delta" || event.type === "done") return true;
        }
        return true;
    } catch (error) {
        if (controller.signal.aborted) throw new Error(`连接测试超时（${Math.round(timeoutMs / 1000)} 秒）`);
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}
