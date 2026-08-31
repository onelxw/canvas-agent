import { describe, expect, it } from "vitest";

import { DEFAULT_INTERNAL_AGENT_LIMITS, DEFAULT_INTERNAL_AGENT_PERMISSIONS } from "../types";
import { runInternalAgent } from "../runtime";
import { internalAgentModelTools, parseInternalAgentToolInput } from "../tools/registry";
import { internalAgentToolNames } from "../tools/schemas";

const toolContext = { hasCanvas: true, projectId: "project-1", permissions: DEFAULT_INTERNAL_AGENT_PERMISSIONS };

describe("internal Agent registry", () => {
    it("only exposes the fixed whitelist", () => {
        expect(internalAgentToolNames).toEqual([
            "canvas_get_state", "canvas_get_selection", "canvas_apply_ops", "canvas_create_text_nodes",
            "canvas_create_generation_flow", "canvas_update_node", "canvas_move_nodes", "canvas_resize_node",
            "canvas_delete_nodes", "canvas_connect_nodes", "canvas_select_nodes", "canvas_set_viewport",
            "canvas_run_generation", "generation_get_status",
        ]);
    });

    it("uses strict schemas and requires revision on writes", () => {
        expect(() => parseInternalAgentToolInput("canvas_delete_nodes", { projectId: "project-1", ids: ["n1"] })).toThrow();
        expect(() => parseInternalAgentToolInput("canvas_get_state", { unexpected: true })).toThrow();
        expect(() => parseInternalAgentToolInput("canvas_apply_ops", {
            projectId: "project-1", expectedRevision: 1, ops: [{ type: "run_generation", nodeId: "n1" }],
        })).toThrow();
    });

    it("emits JSON Schema numeric exclusive bounds for model providers", () => {
        const schemas = internalAgentModelTools(toolContext).map((tool) => JSON.stringify(tool.parameters));
        expect(schemas.some((schema) => schema.includes('"exclusiveMinimum":0'))).toBe(true);
        expect(schemas.every((schema) => !schema.includes('"exclusiveMinimum":true'))).toBe(true);
        expect(schemas.every((schema) => !schema.includes('"$schema"'))).toBe(true);
    });
});

describe("internal Agent runtime", () => {
    it("does not execute a duplicated call id twice", async () => {
        let rounds = 0;
        let executions = 0;
        const result = await runInternalAgent({
            messages: [{ role: "user", content: "read" }],
            limits: DEFAULT_INTERNAL_AGENT_LIMITS,
            toolContext,
            streamModel: async function* () {
                rounds += 1;
                if (rounds <= 2) yield { type: "tool_call", call: { id: "same-id", name: "canvas_get_state", arguments: "{}" } };
                else yield { type: "text_delta", delta: "done" };
                yield { type: "done" };
            },
            executeTool: async () => { executions += 1; return { revision: 1 }; },
            confirmTool: async () => ({ approved: true }),
        });
        expect(result.reason).toBe("assistant");
        expect(executions).toBe(1);
        expect(result.messages.some((message) => message.role === "tool" && message.content.includes("重复"))).toBe(true);
    });

    it("does not execute a rejected write", async () => {
        let executions = 0;
        let round = 0;
        await runInternalAgent({
            messages: [{ role: "user", content: "delete" }],
            limits: DEFAULT_INTERNAL_AGENT_LIMITS,
            toolContext,
            streamModel: async function* () {
                round += 1;
                if (round === 1) yield { type: "tool_call", call: { id: "delete-1", name: "canvas_delete_nodes", arguments: JSON.stringify({ projectId: "project-1", expectedRevision: 1, ids: ["n1"] }) } };
                else yield { type: "text_delta", delta: "cancelled" };
                yield { type: "done" };
            },
            executeTool: async () => { executions += 1; },
            confirmTool: async () => ({ approved: false }),
        });
        expect(executions).toBe(0);
    });
});
