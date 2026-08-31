import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChatCompletionsAgent } from "../chat-completions";
import { streamResponsesAgent } from "../responses";
import type { InternalAgentModelRequest } from "../types";

const baseRequest: InternalAgentModelRequest = {
    protocol: "openai-responses",
    baseUrl: "https://example.com",
    apiKey: "secret",
    model: "test-model",
    messages: [{ role: "user", content: "test" }],
    tools: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("internal Agent protocol adapters", () => {
    it("normalizes Responses text and tool events", async () => {
        stubSse([
            { type: "response.output_text.delta", delta: "hello" },
            { type: "response.function_call_arguments.done", call_id: "c1", name: "canvas_get_state", arguments: "{}" },
            { type: "response.completed", response: { id: "r1", output: [], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
        ]);
        const events = await collect(streamResponsesAgent(baseRequest));
        expect(events).toContainEqual({ type: "text_delta", delta: "hello" });
        expect(events).toContainEqual({ type: "tool_call", call: { id: "c1", name: "canvas_get_state", arguments: "{}" } });
        expect(events.at(-1)).toEqual({ type: "done", responseId: "r1" });
        expect(requestBody()).not.toHaveProperty("tools");
        expect(requestBody()).not.toHaveProperty("tool_choice");
    });

    it("joins fragmented Chat Completions tool arguments", async () => {
        stubSse([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "c2", function: { name: "canvas_get_", arguments: "{" } }] }, finish_reason: null }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "state", arguments: "}" } }] }, finish_reason: "tool_calls" }] },
        ]);
        const events = await collect(streamChatCompletionsAgent({ ...baseRequest, protocol: "openai-chat-completions" }));
        expect(events).toContainEqual({ type: "tool_call", call: { id: "c2", name: "canvas_get_state", arguments: "{}" } });
        expect(events.at(-1)).toEqual({ type: "done" });
        expect(requestBody()).not.toHaveProperty("stream_options");
    });

    it("does not send provider strict mode while retaining JSON schemas", async () => {
        stubSse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
        await collect(streamChatCompletionsAgent({
            ...baseRequest,
            protocol: "openai-chat-completions",
            tools: [{ type: "function", name: "canvas_get_state", description: "read", parameters: { type: "object", properties: {}, additionalProperties: false } }],
        }));
        const tool = (requestBody().tools as Array<{ function: Record<string, unknown> }>)[0];
        expect(tool.function).not.toHaveProperty("strict");
        expect(tool.function.parameters).toEqual({ type: "object", properties: {}, additionalProperties: false });
    });
});

function stubSse(values: unknown[]) {
    const body = `${values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("")}data: [DONE]\n\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
}

async function collect<T>(stream: AsyncGenerator<T>) {
    const result: T[] = [];
    for await (const item of stream) result.push(item);
    return result;
}

function requestBody() {
    const fetchMock = vi.mocked(fetch);
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    return JSON.parse(String(init.body)) as Record<string, unknown>;
}
