import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { InternalAgentCanvasContext } from "@/lib/internal-agent/tools/executor";
import {
    DEFAULT_INTERNAL_AGENT_LIMITS,
    DEFAULT_INTERNAL_AGENT_PERMISSIONS,
    type InternalAgentLimits,
    type InternalAgentMessage,
    type InternalAgentPermissionSettings,
    type InternalAgentToolCall,
} from "@/lib/internal-agent/types";

export const INTERNAL_AGENT_STORE_KEY = "infinite-canvas:internal_agent_store";
export const INTERNAL_AGENT_STORAGE_VERSION = 2;
export const INTERNAL_AGENT_PROTOCOL_VERSION = 1;

export type InternalAgentRunState = "idle" | "running" | "interrupted" | "error";
export type InternalAgentPendingConfirmation = { id: string; call: InternalAgentToolCall; input: unknown };
export type InternalAgentThread = { id: string; title: string; messages: InternalAgentMessage[]; createdAt: string; updatedAt: string };

type InternalAgentStore = {
    storageVersion: number;
    protocolVersion: number;
    hydrated: boolean;
    activeThreadId: string;
    threads: InternalAgentThread[];
    messages: InternalAgentMessage[];
    permissions: InternalAgentPermissionSettings;
    limits: InternalAgentLimits;
    systemPrompt: string;
    runState: InternalAgentRunState;
    error: string;
    canvasContext: InternalAgentCanvasContext | null;
    pendingConfirmation: InternalAgentPendingConfirmation | null;
    setHydrated: (hydrated: boolean) => void;
    setCanvasContext: (context: InternalAgentCanvasContext | null) => void;
    setPermissions: (patch: Partial<InternalAgentPermissionSettings>) => void;
    setLimits: (patch: Partial<InternalAgentLimits>) => void;
    setSystemPrompt: (systemPrompt: string) => void;
    setRunState: (runState: InternalAgentRunState, error?: string) => void;
    setMessages: (messages: InternalAgentMessage[]) => void;
    appendMessage: (message: Omit<InternalAgentMessage, "id" | "itemId" | "threadId" | "createdAt"> & Partial<Pick<InternalAgentMessage, "id" | "itemId" | "threadId" | "createdAt">>) => InternalAgentMessage;
    updateMessage: (id: string, patch: Partial<InternalAgentMessage>) => void;
    clearConversation: () => void;
    newConversation: () => void;
    selectConversation: (threadId: string) => void;
    deleteConversation: (threadId: string) => void;
    setPendingConfirmation: (confirmation: InternalAgentPendingConfirmation | null) => void;
};

const DEFAULT_SYSTEM_PROMPT = `你是 Infinite Canvas 应用内置的专用画布 Agent。你的职责是理解用户意图，并仅通过已提供的白名单工具读取或修改当前画布。
写入前先读取最新画布状态，并使用返回的 projectId 和 revision。不要臆造节点 ID，不要声称执行了尚未执行的操作。生成内容可能产生费用，必须遵守应用的独立生成权限与确认结果。`;

const initialThreadId = nanoid();

function createThread(id = nanoid(), messages: InternalAgentMessage[] = [], timestamp = new Date().toISOString()): InternalAgentThread {
    return { id, title: conversationTitle(messages), messages, createdAt: messages[0]?.createdAt || timestamp, updatedAt: messages.at(-1)?.createdAt || timestamp };
}

function conversationTitle(messages: InternalAgentMessage[]) {
    const text = messages.find((item) => item.role === "user" && item.text.trim())?.text.trim().replace(/\s+/g, " ") || "新对话";
    const chars = Array.from(text);
    return chars.length > 28 ? `${chars.slice(0, 28).join("")}…` : text;
}

function syncThread(threads: InternalAgentThread[], threadId: string, messages: InternalAgentMessage[]) {
    const timestamp = new Date().toISOString();
    const existing = threads.find((thread) => thread.id === threadId);
    const next = { id: threadId, title: conversationTitle(messages), messages, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
    return [next, ...threads.filter((thread) => thread.id !== threadId)];
}

export const useInternalAgentStore = create<InternalAgentStore>()(
    persist(
        (set, get) => ({
            storageVersion: INTERNAL_AGENT_STORAGE_VERSION,
            protocolVersion: INTERNAL_AGENT_PROTOCOL_VERSION,
            hydrated: false,
            activeThreadId: initialThreadId,
            threads: [createThread(initialThreadId)],
            messages: [],
            permissions: DEFAULT_INTERNAL_AGENT_PERMISSIONS,
            limits: DEFAULT_INTERNAL_AGENT_LIMITS,
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            runState: "idle",
            error: "",
            canvasContext: null,
            pendingConfirmation: null,
            setHydrated: (hydrated) => set({ hydrated }),
            setCanvasContext: (canvasContext) => set({ canvasContext }),
            setPermissions: (patch) => set((state) => ({ permissions: { ...state.permissions, ...patch } })),
            setLimits: (patch) => set((state) => ({ limits: { ...state.limits, ...patch } })),
            setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
            setRunState: (runState, error = "") => set({ runState, error }),
            setMessages: (messages) => set((state) => ({ messages, threads: syncThread(state.threads, state.activeThreadId, messages) })),
            appendMessage: (value) => {
                const message: InternalAgentMessage = {
                    id: value.id || nanoid(),
                    itemId: value.itemId || nanoid(),
                    threadId: value.threadId || get().activeThreadId,
                    turnId: value.turnId,
                    role: value.role,
                    text: value.text,
                    toolCallId: value.toolCallId,
                    toolName: value.toolName,
                    toolCalls: value.toolCalls,
                    createdAt: value.createdAt || new Date().toISOString(),
                };
                set((state) => {
                    const messages = [...state.messages, message];
                    return { messages, threads: syncThread(state.threads, state.activeThreadId, messages) };
                });
                return message;
            },
            updateMessage: (id, patch) => set((state) => {
                const messages = state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
                return { messages, threads: syncThread(state.threads, state.activeThreadId, messages) };
            }),
            clearConversation: () => set((state) => ({ messages: [], threads: syncThread(state.threads, state.activeThreadId, []), runState: "idle", error: "", pendingConfirmation: null })),
            newConversation: () => set((state) => {
                if (!state.messages.length) return { runState: "idle", error: "", pendingConfirmation: null };
                const thread = createThread();
                return { activeThreadId: thread.id, threads: [thread, ...state.threads], messages: [], runState: "idle", error: "", pendingConfirmation: null };
            }),
            selectConversation: (threadId) => set((state) => {
                const thread = state.threads.find((item) => item.id === threadId);
                return thread ? { activeThreadId: thread.id, messages: thread.messages, runState: "idle", error: "", pendingConfirmation: null } : {};
            }),
            deleteConversation: (threadId) => set((state) => {
                const threads = state.threads.filter((thread) => thread.id !== threadId);
                if (threadId !== state.activeThreadId) return { threads };
                const next = threads[0] || createThread();
                return { activeThreadId: next.id, threads: threads.length ? threads : [next], messages: next.messages, runState: "idle", error: "", pendingConfirmation: null };
            }),
            setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
        }),
        {
            name: INTERNAL_AGENT_STORE_KEY,
            version: INTERNAL_AGENT_STORAGE_VERSION,
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({
                storageVersion: state.storageVersion,
                protocolVersion: state.protocolVersion,
                activeThreadId: state.activeThreadId,
                threads: state.threads,
                messages: state.messages,
                permissions: state.permissions,
                limits: state.limits,
                systemPrompt: state.systemPrompt,
                runState: state.runState === "running" ? "interrupted" : state.runState,
                error: state.runState === "running" ? "页面刷新或应用重启已中断上一次请求" : state.error,
            }),
            migrate: (persisted) => {
                const saved = (persisted || {}) as Partial<InternalAgentStore>;
                if (Array.isArray(saved.threads) && saved.threads.length) return saved;
                const threadId = saved.activeThreadId || nanoid();
                const messages = Array.isArray(saved.messages) ? saved.messages : [];
                return { ...saved, activeThreadId: threadId, threads: [createThread(threadId, messages)] };
            },
            merge: (persisted, current) => {
                const saved = (persisted || {}) as Partial<InternalAgentStore>;
                const threads = Array.isArray(saved.threads) && saved.threads.length ? saved.threads : [createThread(saved.activeThreadId || current.activeThreadId, saved.messages || [])];
                const activeThreadId = threads.some((thread) => thread.id === saved.activeThreadId) ? saved.activeThreadId! : threads[0].id;
                const messages = threads.find((thread) => thread.id === activeThreadId)?.messages || [];
                return {
                    ...current,
                    ...saved,
                    storageVersion: INTERNAL_AGENT_STORAGE_VERSION,
                    protocolVersion: INTERNAL_AGENT_PROTOCOL_VERSION,
                    activeThreadId,
                    threads,
                    messages,
                    permissions: { ...DEFAULT_INTERNAL_AGENT_PERMISSIONS, ...saved.permissions },
                    limits: { ...DEFAULT_INTERNAL_AGENT_LIMITS, ...saved.limits },
                    hydrated: false,
                    canvasContext: null,
                    pendingConfirmation: null,
                    runState: saved.runState === "running" ? "interrupted" : saved.runState || "idle",
                };
            },
            onRehydrateStorage: () => (state) => state?.setHydrated(true),
        },
    ),
);

let activeController: AbortController | null = null;

export function replaceInternalAgentController(controller: AbortController | null) {
    activeController?.abort();
    activeController = controller;
}

export function abortInternalAgentRun() {
    activeController?.abort();
    activeController = null;
}
