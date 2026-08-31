import { ZodError } from "zod";

import type { InternalAgentModelStream, InternalAgentTransportMessage } from "@/services/api/internal-agent/types";
import { serializeInternalAgentResult, trimInternalAgentContext } from "./context";
import {
    availableInternalAgentTools,
    internalAgentModelTools,
    internalAgentToolNeedsConfirmation,
    internalAgentToolRegistry,
    parseInternalAgentToolInput,
    type InternalAgentToolContext,
} from "./tools/registry";
import type { InternalAgentLimits, InternalAgentToolCall, InternalAgentUsage } from "./types";

export type InternalAgentConfirmation = { approved: boolean; reason?: string };

export type InternalAgentRuntimeEvent =
    | { type: "round_started"; round: number }
    | { type: "text_delta"; delta: string }
    | { type: "reasoning_delta"; delta: string }
    | { type: "tool_started"; call: InternalAgentToolCall }
    | { type: "tool_finished"; call: InternalAgentToolCall; result: string; executed: boolean }
    | { type: "usage"; usage: InternalAgentUsage }
    | { type: "completed"; reason: "assistant" | "round_limit" | "aborted" };

export type InternalAgentRuntimeOptions = {
    messages: InternalAgentTransportMessage[];
    limits: InternalAgentLimits;
    toolContext: InternalAgentToolContext;
    signal?: AbortSignal;
    streamModel: (request: {
        messages: InternalAgentTransportMessage[];
        tools: ReturnType<typeof internalAgentModelTools>;
        signal?: AbortSignal;
    }) => InternalAgentModelStream;
    executeTool: (name: string, input: unknown, signal?: AbortSignal) => Promise<unknown>;
    confirmTool: (call: InternalAgentToolCall, input: unknown) => Promise<InternalAgentConfirmation>;
    onEvent?: (event: InternalAgentRuntimeEvent) => void;
};

export type InternalAgentRuntimeResult = {
    messages: InternalAgentTransportMessage[];
    rounds: number;
    toolCalls: number;
    reason: "assistant" | "round_limit" | "aborted";
};

export async function runInternalAgent(options: InternalAgentRuntimeOptions): Promise<InternalAgentRuntimeResult> {
    let messages = [...options.messages];
    let totalToolCalls = 0;
    const executedCallIds = new Set<string>();
    const availableNames = new Set(availableInternalAgentTools(options.toolContext).map((tool) => tool.name));

    for (let round = 1; round <= options.limits.maxModelRounds; round += 1) {
        if (options.signal?.aborted) return finish(options, messages, round - 1, totalToolCalls, "aborted");
        options.onEvent?.({ type: "round_started", round });
        const calls: InternalAgentToolCall[] = [];
        let assistantText = "";
        let modelError = "";

        try {
            for await (const event of options.streamModel({
                messages: trimInternalAgentContext(messages, options.limits),
                tools: internalAgentModelTools(options.toolContext),
                signal: options.signal,
            })) {
                if (options.signal?.aborted) return finish(options, messages, round, totalToolCalls, "aborted");
                if (event.type === "text_delta") {
                    assistantText += event.delta;
                    options.onEvent?.(event);
                } else if (event.type === "reasoning_delta" || event.type === "usage") {
                    options.onEvent?.(event);
                } else if (event.type === "tool_call") {
                    calls.push(event.call);
                } else if (event.type === "error") {
                    modelError = event.message;
                }
            }
        } catch (error) {
            if (options.signal?.aborted) return finish(options, messages, round, totalToolCalls, "aborted");
            throw error;
        }
        if (modelError) throw new Error(modelError);

        const allowedCalls = calls.slice(0, options.limits.maxToolCallsPerRound);
        messages.push({ role: "assistant", content: assistantText, toolCalls: allowedCalls.length ? allowedCalls : undefined });
        if (!allowedCalls.length) return finish(options, messages, round, totalToolCalls, "assistant");

        for (const call of allowedCalls) {
            if (options.signal?.aborted) return finish(options, messages, round, totalToolCalls, "aborted");
            if (totalToolCalls >= options.limits.maxTotalToolCalls) {
                messages.push(toolMessage(call, serializeInternalAgentResult({ ok: false, error: "已达到本次请求的工具调用总上限" }, options.limits.maxToolResultChars)));
                continue;
            }
            totalToolCalls += 1;
            options.onEvent?.({ type: "tool_started", call });
            const outcome = await handleToolCall(options, call, availableNames, executedCallIds);
            messages.push(toolMessage(call, outcome.result));
            options.onEvent?.({ type: "tool_finished", call, ...outcome });
        }
    }

    return finish(options, messages, options.limits.maxModelRounds, totalToolCalls, "round_limit");
}

async function handleToolCall(
    options: InternalAgentRuntimeOptions,
    call: InternalAgentToolCall,
    availableNames: Set<string>,
    executedCallIds: Set<string>,
): Promise<{ result: string; executed: boolean }> {
    const respond = (value: unknown, executed = false) => ({ result: serializeInternalAgentResult(value, options.limits.maxToolResultChars), executed });
    if (!call.id) return respond({ ok: false, error: "工具调用缺少 ID" });
    if (executedCallIds.has(call.id)) return respond({ ok: false, error: "重复的工具调用 ID，已阻止再次执行", callId: call.id });
    executedCallIds.add(call.id);
    if (!availableNames.has(call.name)) return respond({ ok: false, error: `工具不可用或无权限：${call.name}` });
    if (!(call.name in internalAgentToolRegistry)) return respond({ ok: false, error: `未注册工具：${call.name}` });

    let input: unknown;
    try {
        input = parseInternalAgentToolInput(call.name, JSON.parse(call.arguments || "{}"));
    } catch (error) {
        const details = error instanceof ZodError ? error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) : undefined;
        return respond({ ok: false, error: error instanceof SyntaxError ? "工具参数不是有效 JSON" : "工具参数校验失败", details });
    }

    const tool = internalAgentToolRegistry[call.name as keyof typeof internalAgentToolRegistry];
    if (internalAgentToolNeedsConfirmation(tool.name, options.toolContext.permissions)) {
        const confirmation = await options.confirmTool(call, input);
        if (!confirmation.approved) return respond({ ok: false, error: "用户拒绝了此工具调用", reason: confirmation.reason });
    }

    try {
        return respond({ ok: true, data: await options.executeTool(call.name, input, options.signal) }, true);
    } catch (error) {
        return respond({ ok: false, error: error instanceof Error ? error.message : "工具执行失败" }, true);
    }
}

function toolMessage(call: InternalAgentToolCall, content: string): InternalAgentTransportMessage {
    return { role: "tool", toolCallId: call.id, content };
}

function finish(
    options: InternalAgentRuntimeOptions,
    messages: InternalAgentTransportMessage[],
    rounds: number,
    toolCalls: number,
    reason: InternalAgentRuntimeResult["reason"],
) {
    options.onEvent?.({ type: "completed", reason });
    return { messages, rounds, toolCalls, reason };
}
