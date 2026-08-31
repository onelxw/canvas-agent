import { useMemo, useRef, useState } from "react";
import { Alert, App, Button, Empty, Popover, Switch, Tooltip } from "antd";
import { Bot, CircleStop, PanelRightClose, Plus, Send, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { runInternalAgent, createInternalAgentToolExecutor, type InternalAgentConfirmation } from "@/lib/internal-agent";
import { streamInternalAgentModel, testInternalAgentConnection, type InternalAgentTransportMessage } from "@/services/api/internal-agent";
import { resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";
import { abortInternalAgentRun, replaceInternalAgentController, useInternalAgentStore } from "@/stores/use-internal-agent-store";
import { useAgentStore } from "@/stores/use-agent-store";
import type { InternalAgentMessage, InternalAgentToolCall } from "@/lib/internal-agent/types";

export function InternalAgentPanel() {
    const { message } = App.useApp();
    const [prompt, setPrompt] = useState("");
    const [testing, setTesting] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const confirmationRef = useRef<((result: InternalAgentConfirmation) => void) | null>(null);
    const closePanel = useAgentStore((state) => state.closePanel);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const {
        messages,
        permissions,
        limits,
        systemPrompt,
        runState,
        error,
        canvasContext,
        pendingConfirmation,
        appendMessage,
        updateMessage,
        setMessages,
        setPermissions,
        setRunState,
        setPendingConfirmation,
        newConversation,
        clearConversation,
    } = useInternalAgentStore();
    const running = runState === "running";
    const requestConfig = useMemo(() => resolveModelRequestConfig(config, config.textModel), [config]);

    const settleConfirmation = (result: InternalAgentConfirmation) => {
        confirmationRef.current?.(result);
        confirmationRef.current = null;
        setPendingConfirmation(null);
    };

    const send = async () => {
        const text = prompt.trim();
        if (!text || running) return;
        if (!requestConfig.model || !requestConfig.baseUrl || !requestConfig.apiKey) {
            openConfigDialog(false, "channels");
            message.warning("请先配置可用的文本模型、接口地址和 API Key");
            return;
        }
        const turnId = nanoid();
        const user = appendMessage({ turnId, role: "user", text });
        const initialMessages = [...messages, user];
        const controller = new AbortController();
        replaceInternalAgentController(controller);
        setPrompt("");
        setRunState("running");
        let activeAssistantId = "";
        const toolMessageIds = new Map<string, string>();

        try {
            const toolContext = { hasCanvas: Boolean(canvasContext), projectId: canvasContext?.getSnapshot().projectId, permissions };
            const result = await runInternalAgent({
                messages: storedToTransport(systemPrompt, initialMessages),
                limits,
                toolContext,
                signal: controller.signal,
                streamModel: ({ messages: contextMessages, tools, signal }) =>
                    streamInternalAgentModel({
                        protocol: requestConfig.agentProtocol,
                        baseUrl: requestConfig.baseUrl,
                        apiKey: requestConfig.apiKey,
                        model: requestConfig.model,
                        messages: contextMessages,
                        tools,
                        signal,
                    }),
                executeTool: canvasContext ? createInternalAgentToolExecutor(canvasContext, limits) : async () => { throw new Error("当前未打开画布"); },
                confirmTool: (call, input) => new Promise((resolve) => {
                    confirmationRef.current = resolve;
                    setPendingConfirmation({ id: nanoid(), call, input });
                }),
                onEvent: (event) => {
                    if (event.type === "round_started") {
                        activeAssistantId = appendMessage({ turnId, role: "assistant", text: "" }).id;
                    } else if (event.type === "text_delta" && activeAssistantId) {
                        const current = useInternalAgentStore.getState().messages.find((item) => item.id === activeAssistantId);
                        updateMessage(activeAssistantId, { text: `${current?.text || ""}${event.delta}` });
                    } else if (event.type === "tool_started") {
                        const item = appendMessage({ turnId, role: "tool", text: `正在执行 ${event.call.name}`, toolCallId: event.call.id, toolName: event.call.name });
                        toolMessageIds.set(event.call.id, item.id);
                    } else if (event.type === "tool_finished") {
                        const id = toolMessageIds.get(event.call.id);
                        if (id) updateMessage(id, { text: toolResultLabel(event.call, event.result, event.executed) });
                    }
                    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
                },
            });
            setMessages(transportToStored(result.messages, useInternalAgentStore.getState().activeThreadId, turnId));
            setRunState(result.reason === "aborted" ? "interrupted" : result.reason === "round_limit" ? "error" : "idle", result.reason === "round_limit" ? "已达到最大模型轮数" : "");
        } catch (caught) {
            const detail = caught instanceof Error ? caught.message : "请求失败";
            appendMessage({ turnId, role: "error", text: detail });
            setRunState(controller.signal.aborted ? "interrupted" : "error", detail);
        } finally {
            replaceInternalAgentController(null);
            if (confirmationRef.current) settleConfirmation({ approved: false, reason: "请求已结束" });
        }
    };

    const stop = () => {
        abortInternalAgentRun();
        if (confirmationRef.current) settleConfirmation({ approved: false, reason: "用户停止了请求" });
    };

    const testConnection = async () => {
        if (!requestConfig.model || !requestConfig.baseUrl || !requestConfig.apiKey) return openConfigDialog(false, "channels");
        setTesting(true);
        try {
            await testInternalAgentConnection({ protocol: requestConfig.agentProtocol, baseUrl: requestConfig.baseUrl, apiKey: requestConfig.apiKey, model: requestConfig.model }, limits.connectionTestTimeoutMs);
            message.success("Agent 连接测试成功");
        } catch (caught) {
            message.error(caught instanceof Error ? caught.message : "Agent 连接测试失败");
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-200 px-3 dark:border-stone-800">
                <Bot className="size-5" />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">画布 Agent</div>
                    <div className="truncate text-[11px] text-stone-500">{requestConfig.model || "未配置文本模型"} · {requestConfig.agentProtocol === "openai-responses" ? "Responses" : "Chat Completions"}</div>
                </div>
                <Tooltip title="新对话"><Button size="small" type="text" aria-label="新对话" icon={<Plus className="size-4" />} onClick={newConversation} disabled={running} /></Tooltip>
                <Popover trigger="click" placement="bottomRight" content={<PermissionSettings permissions={permissions} onChange={setPermissions} onOpenConfig={() => openConfigDialog(false, "channels")} onTest={() => void testConnection()} testing={testing} />}>
                    <Button size="small" type="text" aria-label="Agent 设置" icon={<Settings2 className="size-4" />} />
                </Popover>
                <Tooltip title="收起"><Button size="small" type="text" aria-label="收起 Agent" icon={<PanelRightClose className="size-4" />} onClick={closePanel} /></Tooltip>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                {!messages.length ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={canvasContext ? "告诉我你想如何编辑当前画布" : "打开一个画布后即可读取和编辑节点"} />
                ) : (
                    <div className="space-y-3">
                        {messages.map((item) => <MessageBubble key={item.id} item={item} />)}
                    </div>
                )}
                {error && runState !== "idle" && !(messages.at(-1)?.role === "error" && messages.at(-1)?.text === error) ? <Alert className="mt-3" type={runState === "interrupted" ? "warning" : "error"} showIcon message={error} /> : null}
                <div ref={bottomRef} />
            </main>

            {pendingConfirmation ? (
                <div className="mx-3 mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-stone-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-stone-100">
                    <div className="text-sm font-semibold">确认执行：{pendingConfirmation.call.name}</div>
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs opacity-75">{JSON.stringify(pendingConfirmation.input, null, 2)}</pre>
                    <div className="mt-3 flex justify-end gap-2">
                        <Button size="small" onClick={() => settleConfirmation({ approved: false, reason: "用户拒绝" })}>拒绝</Button>
                        <Button size="small" type="primary" onClick={() => settleConfirmation({ approved: true })}>允许本次</Button>
                    </div>
                </div>
            ) : null}

            <footer className="shrink-0 border-t border-stone-200 p-3 dark:border-stone-800">
                <textarea
                    className="min-h-24 w-full resize-none rounded-xl border border-stone-300 bg-transparent p-3 text-sm outline-none focus:border-blue-500 dark:border-stone-700"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void send();
                        }
                    }}
                    placeholder="描述你想对画布做什么…"
                    disabled={running}
                />
                <div className="mt-2 flex items-center justify-between">
                    <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={clearConversation} disabled={running || !messages.length}>清空</Button>
                    {running ? (
                        <Button danger icon={<CircleStop className="size-4" />} onClick={stop}>停止</Button>
                    ) : (
                        <Button type="primary" icon={<Send className="size-4" />} onClick={() => void send()} disabled={!prompt.trim()}>发送</Button>
                    )}
                </div>
            </footer>
        </div>
    );
}

function MessageBubble({ item }: { item: InternalAgentMessage }) {
    const isUser = item.role === "user";
    const isTool = item.role === "tool";
    return (
        <div className={isUser ? "flex justify-end" : "flex justify-start"}>
            <div className={isUser ? "max-w-[88%] rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white" : isTool ? "max-w-full rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300" : item.role === "error" ? "max-w-[92%] rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" : "max-w-[92%] whitespace-pre-wrap text-sm leading-6"}>
                {item.text || (item.role === "assistant" ? "思考中…" : "")}
            </div>
        </div>
    );
}

function PermissionSettings({ permissions, onChange, onOpenConfig, onTest, testing }: { permissions: ReturnType<typeof useInternalAgentStore.getState>["permissions"]; onChange: (patch: Partial<typeof permissions>) => void; onOpenConfig: () => void; onTest: () => void; testing: boolean }) {
    return (
        <div className="w-72 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4" />权限设置</div>
            <SettingRow label="允许读取画布" checked={permissions.read} onChange={(read) => onChange({ read })} />
            <SettingRow label="允许修改画布" checked={permissions.canvas_write} onChange={(canvas_write) => onChange({ canvas_write })} />
            <SettingRow label="允许内容生成" checked={permissions.generation} onChange={(generation) => onChange({ generation })} />
            <SettingRow label="自动确认画布修改" checked={permissions.autoConfirmCanvasWrite} onChange={(autoConfirmCanvasWrite) => onChange({ autoConfirmCanvasWrite })} />
            <SettingRow label="自动确认内容生成" checked={permissions.autoConfirmGeneration} onChange={(autoConfirmGeneration) => onChange({ autoConfirmGeneration })} />
            <Button block loading={testing} onClick={onTest}>测试 Agent 连接</Button>
            <Button block onClick={onOpenConfig}>模型与协议配置</Button>
        </div>
    );
}

function SettingRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return <label className="flex items-center justify-between gap-4 text-sm"><span>{label}</span><Switch size="small" checked={checked} onChange={onChange} /></label>;
}

function storedToTransport(systemPrompt: string, messages: InternalAgentMessage[]): InternalAgentTransportMessage[] {
    return [
        { role: "system", content: systemPrompt },
        ...messages.filter((item) => item.role !== "error").map((item) => ({
            role: item.role as "user" | "assistant" | "tool",
            content: item.text,
            toolCallId: item.toolCallId,
            toolCalls: item.toolCalls,
        })),
    ];
}

function transportToStored(messages: InternalAgentTransportMessage[], threadId: string, turnId: string): InternalAgentMessage[] {
    return messages.filter((item) => item.role !== "system").map((item) => ({
        id: nanoid(),
        itemId: nanoid(),
        threadId,
        turnId,
        role: item.role,
        text: item.content,
        toolCallId: item.toolCallId,
        toolCalls: item.toolCalls,
        toolName: item.toolCalls?.[0]?.name,
        createdAt: new Date().toISOString(),
    }));
}

function toolResultLabel(call: InternalAgentToolCall, result: string, executed: boolean) {
    try {
        const parsed = JSON.parse(result) as { ok?: boolean; error?: string; data?: { revision?: number } };
        if (!parsed.ok) return `${call.name}：${parsed.error || "未执行"}`;
        return `${call.name}${executed ? " 已完成" : " 已处理"}${parsed.data?.revision !== undefined ? ` · revision ${parsed.data.revision}` : ""}`;
    } catch {
        return `${call.name}${executed ? " 已完成" : " 已处理"}`;
    }
}
