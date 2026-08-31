import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeData } from "@/types/canvas";
import type { InternalAgentLimits } from "../types";
import { buildInternalAgentCanvasOps } from "./operations";

export type InternalAgentRevisionedSnapshot = CanvasAgentSnapshot & { revision: number };

export type InternalAgentCanvasContext = {
    getSnapshot: () => InternalAgentRevisionedSnapshot;
    applyOps: (ops: CanvasAgentOp[]) => Promise<InternalAgentRevisionedSnapshot> | InternalAgentRevisionedSnapshot;
    runGeneration: (request: { nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string }) => Promise<void>;
};

export function createInternalAgentToolExecutor(context: InternalAgentCanvasContext, limits: InternalAgentLimits) {
    return async (name: string, value: unknown) => {
        const input = value as Record<string, unknown>;
        const snapshot = context.getSnapshot();
        if (name === "canvas_get_state") return compactSnapshot(snapshot);
        if (name === "canvas_get_selection") {
            const selected = new Set(snapshot.selectedNodeIds);
            return { projectId: snapshot.projectId, revision: snapshot.revision, nodes: snapshot.nodes.filter((node) => selected.has(node.id)).map(compactNode) };
        }
        assertProject(input, snapshot);
        if (name === "generation_get_status") return generationStatus(snapshot, input);
        assertRevision(input, snapshot);

        if (name === "canvas_run_generation") {
            const nodeId = String(input.nodeId);
            assertKnownNodes(snapshot, [nodeId]);
            await context.runGeneration({ nodeId, mode: input.mode as "text" | "image" | "video" | "audio" | undefined, prompt: input.prompt as string | undefined });
            return { accepted: true, projectId: snapshot.projectId, revision: context.getSnapshot().revision, nodeId };
        }

        const ops = buildInternalAgentCanvasOps(name, input, snapshot);
        assertOperationLimits(ops, limits);
        assertOperationReferences(snapshot, ops);
        const next = await context.applyOps(ops);
        return { applied: true, projectId: next.projectId, revision: next.revision, operationCount: ops.length, affectedNodeIds: affectedNodeIds(ops) };
    };
}

function assertProject(input: Record<string, unknown>, snapshot: InternalAgentRevisionedSnapshot) {
    if (input.projectId !== snapshot.projectId) throw new Error("画布项目已切换，请重新读取当前画布状态");
}

function assertRevision(input: Record<string, unknown>, snapshot: InternalAgentRevisionedSnapshot) {
    if (input.expectedRevision !== snapshot.revision) throw new Error(`画布内容已变化：期望 revision ${String(input.expectedRevision)}，当前为 ${snapshot.revision}。请重新读取后再操作`);
}

function assertOperationLimits(ops: CanvasAgentOp[], limits: InternalAgentLimits) {
    if (ops.length > limits.maxCanvasOps) throw new Error(`单次画布操作不能超过 ${limits.maxCanvasOps} 项`);
    const affected = affectedNodeIds(ops);
    if (affected.length > limits.maxAffectedNodes) throw new Error(`单次操作影响的节点不能超过 ${limits.maxAffectedNodes} 个`);
}

function assertOperationReferences(snapshot: InternalAgentRevisionedSnapshot, ops: CanvasAgentOp[]) {
    const known = new Set(snapshot.nodes.map((node) => node.id));
    for (const op of ops) {
        if (op.type === "add_node" && op.id) known.add(op.id);
        if (op.type === "update_node") assertKnown(known, op.id);
        if (op.type === "delete_node") (op.ids || (op.id ? [op.id] : [])).forEach((id) => assertKnown(known, id));
        if (op.type === "connect_nodes") {
            assertKnown(known, op.fromNodeId);
            assertKnown(known, op.toNodeId);
        }
        if (op.type === "select_nodes") op.ids.forEach((id) => assertKnown(known, id));
    }
}

function assertKnownNodes(snapshot: InternalAgentRevisionedSnapshot, ids: string[]) {
    const known = new Set(snapshot.nodes.map((node) => node.id));
    ids.forEach((id) => assertKnown(known, id));
}

function assertKnown(known: Set<string>, id: string) {
    if (!known.has(id)) throw new Error(`节点不存在：${id}`);
}

function affectedNodeIds(ops: CanvasAgentOp[]) {
    const ids = new Set<string>();
    ops.forEach((op) => {
        if (op.type === "add_node" && op.id) ids.add(op.id);
        if (op.type === "update_node") ids.add(op.id);
        if (op.type === "delete_node") (op.ids || (op.id ? [op.id] : [])).forEach((id) => ids.add(id));
        if (op.type === "connect_nodes") {
            ids.add(op.fromNodeId);
            ids.add(op.toNodeId);
        }
        if (op.type === "select_nodes") op.ids.forEach((id) => ids.add(id));
        if (op.type === "run_generation") ids.add(op.nodeId);
    });
    return [...ids];
}

function compactSnapshot(snapshot: InternalAgentRevisionedSnapshot) {
    return {
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        title: snapshot.title,
        nodes: snapshot.nodes.map(compactNode),
        connections: snapshot.connections,
        selectedNodeIds: snapshot.selectedNodeIds,
        viewport: snapshot.viewport,
    };
}

function compactNode(node: CanvasNodeData) {
    const metadata = node.metadata || {};
    return {
        id: node.id,
        type: node.type,
        title: node.title,
        position: node.position,
        width: node.width,
        height: node.height,
        metadata: compactRecord({
            content: truncate(typeof metadata.content === "string" ? metadata.content : "", 4_000),
            prompt: truncate(typeof metadata.prompt === "string" ? metadata.prompt : "", 4_000),
            composerContent: truncate(typeof metadata.composerContent === "string" ? metadata.composerContent : "", 4_000),
            generationMode: metadata.generationMode,
            model: metadata.model,
            status: metadata.status,
            errorDetails: truncate(typeof metadata.errorDetails === "string" ? metadata.errorDetails : "", 1_000),
        }),
    };
}

function generationStatus(snapshot: InternalAgentRevisionedSnapshot, input: Record<string, unknown>) {
    const ids = new Set((input.nodeIds as string[] | undefined) || []);
    const limit = Math.min(Number(input.limit) || 50, 50);
    return {
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        nodes: snapshot.nodes.filter((node) => !ids.size || ids.has(node.id)).slice(0, limit).map((node) => ({
            id: node.id,
            status: node.metadata?.status || "idle",
            errorDetails: truncate(typeof node.metadata?.errorDetails === "string" ? node.metadata.errorDetails : "", 1_000),
        })),
    };
}

function truncate(value: string, length: number) {
    return value.length > length ? `${value.slice(0, length)}…` : value || undefined;
}

function compactRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
