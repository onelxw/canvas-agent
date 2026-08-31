import { buildApiUrl } from "@/stores/use-config-store";
import type { InternalAgentModelEvent, InternalAgentToolCall } from "@/lib/internal-agent/types";
import type { InternalAgentModelRequest, InternalAgentTransportMessage } from "./types";
import { apiErrorMessage, asRecord, modelFetch, numberValue, readSseJson, stringValue } from "./sse";

export async function* streamResponsesAgent(request: InternalAgentModelRequest): AsyncGenerator<InternalAgentModelEvent> {
    const response = await modelFetch(buildApiUrl(request.baseUrl, "/responses"), request.apiKey, {
        model: request.model,
        input: responsesInput(request.messages),
        ...(request.tools.length ? { tools: request.tools, tool_choice: "auto" } : {}),
        stream: true,
    }, request.signal);
    const calls = new Map<string, InternalAgentToolCall>();
    const emitted = new Set<string>();
    let responseId = "";
    let completed = false;

    for await (const { data } of readSseJson(response)) {
        const type = stringValue(data.type);
        if (type === "response.output_text.delta") {
            const delta = stringValue(data.delta);
            if (delta) yield { type: "text_delta", delta };
            continue;
        }
        if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
            const delta = stringValue(data.delta);
            if (delta) yield { type: "reasoning_delta", delta };
            continue;
        }
        if (type === "response.output_item.added" || type === "response.output_item.done") {
            const item = asRecord(data.item);
            if (item.type === "function_call") collectResponseCall(calls, item);
            if (type === "response.output_item.done") yield* emitResponseCall(calls, emitted, stringValue(item.call_id) || stringValue(item.id));
            continue;
        }
        if (type === "response.function_call_arguments.delta") {
            const id = stringValue(data.call_id) || stringValue(data.item_id) || `tool-${numberValue(data.output_index) || 0}`;
            const current = calls.get(id) || { id, name: stringValue(data.name), arguments: "" };
            current.name ||= stringValue(data.name);
            current.arguments += stringValue(data.delta);
            calls.set(id, current);
            continue;
        }
        if (type === "response.function_call_arguments.done") {
            const id = stringValue(data.call_id) || stringValue(data.item_id) || `tool-${numberValue(data.output_index) || 0}`;
            const current = calls.get(id) || { id, name: stringValue(data.name), arguments: "" };
            current.name ||= stringValue(data.name);
            current.arguments = stringValue(data.arguments) || current.arguments || "{}";
            calls.set(id, current);
            yield* emitResponseCall(calls, emitted, id);
            continue;
        }
        if (type === "response.completed") {
            const value = asRecord(data.response);
            responseId = stringValue(value.id);
            for (const output of Array.isArray(value.output) ? value.output : []) collectResponseCall(calls, asRecord(output));
            for (const id of calls.keys()) yield* emitResponseCall(calls, emitted, id);
            const usage = asRecord(value.usage);
            if (Object.keys(usage).length) yield { type: "usage", usage: responseUsage(usage) };
            completed = true;
            yield { type: "done", responseId };
            continue;
        }
        if (type === "error" || type === "response.failed" || data.error) {
            yield { type: "error", message: apiErrorMessage(data) };
            return;
        }
    }
    if (!completed) {
        for (const id of calls.keys()) yield* emitResponseCall(calls, emitted, id);
        yield { type: "done", responseId: responseId || undefined };
    }
}

function responsesInput(messages: InternalAgentTransportMessage[]) {
    return messages.flatMap((message): Record<string, unknown>[] => {
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.toolCallId || "", output: message.content }];
        const result: Record<string, unknown>[] = message.content ? [{ role: message.role, content: message.content }] : [];
        if (message.role === "assistant") {
            result.push(...(message.toolCalls || []).map((call) => ({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments })));
        }
        return result;
    });
}

function collectResponseCall(calls: Map<string, InternalAgentToolCall>, item: Record<string, unknown>) {
    if (item.type !== "function_call") return;
    const id = stringValue(item.call_id) || stringValue(item.id);
    if (!id) return;
    calls.set(id, { id, name: stringValue(item.name), arguments: stringValue(item.arguments) || calls.get(id)?.arguments || "{}" });
}

function* emitResponseCall(calls: Map<string, InternalAgentToolCall>, emitted: Set<string>, id: string): Generator<InternalAgentModelEvent> {
    const call = calls.get(id);
    if (!call || emitted.has(id) || !call.name) return;
    emitted.add(id);
    yield { type: "tool_call", call: { ...call, arguments: call.arguments || "{}" } };
}

function responseUsage(value: Record<string, unknown>) {
    const inputDetails = asRecord(value.input_tokens_details);
    return {
        inputTokens: numberValue(value.input_tokens),
        cachedTokens: numberValue(inputDetails.cached_tokens),
        outputTokens: numberValue(value.output_tokens),
        totalTokens: numberValue(value.total_tokens),
    };
}
