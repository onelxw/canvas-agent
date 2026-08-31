import { buildApiUrl } from "@/stores/use-config-store";
import type { InternalAgentModelEvent, InternalAgentToolCall } from "@/lib/internal-agent/types";
import type { InternalAgentModelRequest, InternalAgentTransportMessage } from "./types";
import { apiErrorMessage, asRecord, modelFetch, numberValue, readSseJson, stringValue } from "./sse";

export async function* streamChatCompletionsAgent(request: InternalAgentModelRequest): AsyncGenerator<InternalAgentModelEvent> {
    const response = await modelFetch(buildApiUrl(request.baseUrl, "/chat/completions"), request.apiKey, {
        model: request.model,
        messages: chatMessages(request.messages),
        tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: tool.strict } })),
        tool_choice: "auto",
        stream: true,
        stream_options: { include_usage: true },
    }, request.signal);
    const calls = new Map<number, InternalAgentToolCall>();
    let completed = false;

    for await (const { data } of readSseJson(response)) {
        if (data.error) {
            yield { type: "error", message: apiErrorMessage(data) };
            return;
        }
        const usage = asRecord(data.usage);
        if (Object.keys(usage).length) {
            yield {
                type: "usage",
                usage: {
                    inputTokens: numberValue(usage.prompt_tokens),
                    cachedTokens: numberValue(asRecord(usage.prompt_tokens_details).cached_tokens),
                    outputTokens: numberValue(usage.completion_tokens),
                    totalTokens: numberValue(usage.total_tokens),
                },
            };
        }
        const choices = Array.isArray(data.choices) ? data.choices : [];
        for (const choiceValue of choices) {
            const choice = asRecord(choiceValue);
            const delta = asRecord(choice.delta);
            const text = stringValue(delta.content);
            if (text) yield { type: "text_delta", delta: text };
            const reasoning = stringValue(delta.reasoning_content) || stringValue(delta.reasoning);
            if (reasoning) yield { type: "reasoning_delta", delta: reasoning };
            for (const toolValue of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) collectChatCall(calls, asRecord(toolValue));
            if (choice.finish_reason === "tool_calls") {
                for (const call of orderedCalls(calls)) yield { type: "tool_call", call };
                calls.clear();
            }
            if (choice.finish_reason === "stop") completed = true;
        }
    }
    for (const call of orderedCalls(calls)) yield { type: "tool_call", call };
    yield { type: "done" };
    void completed;
}

function chatMessages(messages: InternalAgentTransportMessage[]) {
    return messages.map((message) => {
        if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId || "", content: message.content };
        if (message.role === "assistant" && message.toolCalls?.length) {
            return {
                role: "assistant",
                content: message.content || null,
                tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
            };
        }
        return { role: message.role, content: message.content };
    });
}

function collectChatCall(calls: Map<number, InternalAgentToolCall>, value: Record<string, unknown>) {
    const index = numberValue(value.index) || 0;
    const fn = asRecord(value.function);
    const current = calls.get(index) || { id: stringValue(value.id) || `tool-${index}`, name: "", arguments: "" };
    current.id = stringValue(value.id) || current.id;
    current.name += stringValue(fn.name);
    current.arguments += stringValue(fn.arguments);
    calls.set(index, current);
}

function orderedCalls(calls: Map<number, InternalAgentToolCall>) {
    return [...calls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => ({ ...call, arguments: call.arguments || "{}" }))
        .filter((call) => call.id && call.name);
}
