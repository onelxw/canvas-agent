import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps } from "@/lib/canvas/canvas-agent-ops";
import { DEFAULT_INTERNAL_AGENT_LIMITS } from "../types";
import { createInternalAgentToolExecutor, type InternalAgentRevisionedSnapshot } from "../tools/executor";

function fixture() {
    let snapshot: InternalAgentRevisionedSnapshot = {
        projectId: "project-1", revision: 3, title: "Test", selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 }, connections: [],
        nodes: [{ id: "n1", type: "text", title: "A", position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: "hello" } }],
    };
    return {
        context: {
            getSnapshot: () => snapshot,
            applyOps: (ops: Parameters<typeof applyCanvasAgentOps>[1]) => {
                snapshot = { ...applyCanvasAgentOps(snapshot, ops), revision: snapshot.revision + 1 };
                return snapshot;
            },
            runGeneration: async () => undefined,
        },
        current: () => snapshot,
    };
}

describe("internal Agent canvas executor", () => {
    it("rejects stale revisions and project switches", async () => {
        const { context } = fixture();
        const execute = createInternalAgentToolExecutor(context, DEFAULT_INTERNAL_AGENT_LIMITS);
        await expect(execute("canvas_delete_nodes", { projectId: "other", expectedRevision: 3, ids: ["n1"] })).rejects.toThrow("项目已切换");
        await expect(execute("canvas_delete_nodes", { projectId: "project-1", expectedRevision: 2, ids: ["n1"] })).rejects.toThrow("画布内容已变化");
    });

    it("applies a validated operation and advances revision", async () => {
        const { context, current } = fixture();
        const execute = createInternalAgentToolExecutor(context, DEFAULT_INTERNAL_AGENT_LIMITS);
        await execute("canvas_update_node", { projectId: "project-1", expectedRevision: 3, id: "n1", patch: { title: "Updated" } });
        expect(current().revision).toBe(4);
        expect(current().nodes[0].title).toBe("Updated");
    });

    it("enforces the operation limit", async () => {
        const { context } = fixture();
        const execute = createInternalAgentToolExecutor(context, { ...DEFAULT_INTERNAL_AGENT_LIMITS, maxCanvasOps: 1 });
        await expect(execute("canvas_apply_ops", {
            projectId: "project-1", expectedRevision: 3,
            ops: [{ type: "select_nodes", ids: [] }, { type: "set_viewport", viewport: { x: 0, y: 0, k: 1 } }],
        })).rejects.toThrow("不能超过 1 项");
    });
});
