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
