import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCanvasToolRequest } from "./operations.js";
import type { CanvasSnapshot } from "./types.js";

function opsOf(name: Parameters<typeof buildCanvasToolRequest>[0], input: Record<string, unknown>, state: CanvasSnapshot | null = null) {
    const request = buildCanvasToolRequest(name, input, state);
    return (request.input as { ops: Array<Record<string, any>> }).ops;
}

test("generation flow reuses referenced nodes when the prompt only mentions them", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "@[node:text-1]", referenceNodeIds: ["text-1"], title: "Flow", autoRun: true });
    const addedTextNodes = ops.filter((op) => op.type === "add_node" && op.nodeType === "text");
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const runs = ops.filter((op) => op.type === "run_generation");
    assert.equal(addedTextNodes.length, 0);
    assert.equal(ops.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "text-1" && String(op.toNodeId).startsWith("config-")).length, 1);
    assert.match(String(config?.metadata?.prompt), /^@\[node:text-1\]$/);
    assert.equal(runs.length, 1);
});

test("generation flow still creates a prompt node for prose prompts", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "a cat on a roof", referenceNodeIds: ["text-1"], autoRun: true });
    assert.equal(ops.filter((op) => op.type === "add_node" && op.nodeType === "text").length, 1);
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.match(String(config?.metadata?.prompt), /@\[node:text-/);
});

test("generation flow explicitly reuses an existing prompt text node", () => {
    const state: CanvasSnapshot = {
        nodes: [{ id: "shot-2", type: "text", title: "Shot 2", position: { x: 20, y: 40 }, width: 340, height: 240 }],
        connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
    };
    const ops = opsOf("canvas_create_generation_flow", { promptNodeId: "shot-2", mode: "video", referenceNodeIds: ["shot-2"] }, state);
    assert.equal(ops.filter((op) => op.type === "add_node" && op.nodeType === "text").length, 0);
    assert.equal(ops.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "shot-2").length, 1);
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.equal(config?.position?.x, 440);
    assert.match(String(config?.metadata?.prompt), /^@\[node:shot-2\]$/);
});
