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
export const INTERNAL_AGENT_STORAGE_VERSION = 1;
export const INTERNAL_AGENT_PROTOCOL_VERSION = 1;

export type InternalAgentRunState = "idle" | "running" | "interrupted" | "error";
export type InternalAgentPendingConfirmation = { id: string; call: InternalAgentToolCall; input: unknown };

type InternalAgentStore = {
    storageVersion: number;
    protocolVersion: number;
    hydrated: boolean;
    activeThreadId: string;
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
    setPendingConfirmation: (confirmation: InternalAgentPendingConfirmation | null) => void;
};

const DEFAULT_SYSTEM_PROMPT = `你是 Infinite Canvas 应用内置的专用画布 Agent。你的职责是理解用户意图，并仅通过已提供的白名单工具读取或修改当前画布。
写入前先读取最新画布状态，并使用返回的 projectId 和 revision。不要臆造节点 ID，不要声称执行了尚未执行的操作。生成内容可能产生费用，必须遵守应用的独立生成权限与确认结果。`;

export const useInternalAgentStore = create<InternalAgentStore>()(
    persist(
        (set, get) => ({
            storageVersion: INTERNAL_AGENT_STORAGE_VERSION,
            protocolVersion: INTERNAL_AGENT_PROTOCOL_VERSION,
            hydrated: false,
            activeThreadId: nanoid(),
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
            setMessages: (messages) => set({ messages }),
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
                    createdAt: value.createdAt || new Date().toISOString(),
                };
                set((state) => ({ messages: [...state.messages, message] }));
                return message;
            },
            updateMessage: (id, patch) => set((state) => ({ messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)) })),
            clearConversation: () => set({ messages: [], runState: "idle", error: "", pendingConfirmation: null }),
            newConversation: () => set({ activeThreadId: nanoid(), messages: [], runState: "idle", error: "", pendingConfirmation: null }),
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
                messages: state.messages,
                permissions: state.permissions,
                limits: state.limits,
                systemPrompt: state.systemPrompt,
                runState: state.runState === "running" ? "interrupted" : state.runState,
                error: state.runState === "running" ? "页面刷新或应用重启已中断上一次请求" : state.error,
            }),
            merge: (persisted, current) => {
                const saved = (persisted || {}) as Partial<InternalAgentStore>;
                return {
                    ...current,
                    ...saved,
                    storageVersion: INTERNAL_AGENT_STORAGE_VERSION,
                    protocolVersion: INTERNAL_AGENT_PROTOCOL_VERSION,
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
