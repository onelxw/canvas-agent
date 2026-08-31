import { beforeEach, describe, expect, it } from "vitest";

import { useInternalAgentStore, type InternalAgentThread } from "@/stores/use-internal-agent-store";

const timestamp = "2026-08-31T00:00:00.000Z";

function emptyThread(id: string): InternalAgentThread {
    return { id, title: "新对话", messages: [], createdAt: timestamp, updatedAt: timestamp };
}

describe("internal agent conversations", () => {
    beforeEach(() => {
        useInternalAgentStore.setState({
            activeThreadId: "thread-a",
            threads: [emptyThread("thread-a")],
            messages: [],
            runState: "idle",
            error: "",
            pendingConfirmation: null,
        });
    });

    it("keeps the previous conversation when a new one is created", () => {
        useInternalAgentStore.getState().appendMessage({ turnId: "turn-a", role: "user", text: "把三张图片连接到生成节点" });
        useInternalAgentStore.getState().newConversation();

        const next = useInternalAgentStore.getState();
        expect(next.threads).toHaveLength(2);
        expect(next.messages).toEqual([]);
        expect(next.threads.find((thread) => thread.id === "thread-a")?.title).toBe("把三张图片连接到生成节点");
        expect(next.threads.find((thread) => thread.id === "thread-a")?.messages).toHaveLength(1);
    });

    it("switches between conversations and selects a fallback after deletion", () => {
        useInternalAgentStore.getState().appendMessage({ turnId: "turn-a", role: "user", text: "第一条对话" });
        useInternalAgentStore.getState().newConversation();
        const secondId = useInternalAgentStore.getState().activeThreadId;
        useInternalAgentStore.getState().appendMessage({ turnId: "turn-b", role: "user", text: "第二条对话" });

        useInternalAgentStore.getState().selectConversation("thread-a");
        expect(useInternalAgentStore.getState().messages[0]?.text).toBe("第一条对话");

        useInternalAgentStore.getState().deleteConversation("thread-a");
        expect(useInternalAgentStore.getState().activeThreadId).toBe(secondId);
        expect(useInternalAgentStore.getState().messages[0]?.text).toBe("第二条对话");
    });

    it("migrates the previous single conversation into history", async () => {
        const legacyMessage = {
            id: "message-a",
            itemId: "item-a",
            threadId: "legacy-thread",
            turnId: "turn-a",
            role: "user" as const,
            text: "升级前的对话",
            createdAt: timestamp,
        };
        const migrate = useInternalAgentStore.persist.getOptions().migrate;
        const migrated = await migrate!({ activeThreadId: "legacy-thread", messages: [legacyMessage] }, 1) as { threads: InternalAgentThread[] };

        expect(migrated.threads).toHaveLength(1);
        expect(migrated.threads[0].id).toBe("legacy-thread");
        expect(migrated.threads[0].title).toBe("升级前的对话");
        expect(migrated.threads[0].messages[0].text).toBe("升级前的对话");
    });
});
