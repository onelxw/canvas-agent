import { nanoid } from "nanoid";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type ToolInput = Record<string, unknown>;

export function buildInternalAgentCanvasOps(name: string, input: ToolInput, snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
    if (name === "canvas_apply_ops") return input.ops as CanvasAgentOp[];
    if (name === "canvas_create_text_nodes") return createTextNodes(input, snapshot);
    if (name === "canvas_create_generation_flow") return createGenerationFlow(input, snapshot);
    if (name === "canvas_update_node") {
        return [{ type: "update_node", id: String(input.id), patch: input.patch as Partial<CanvasNodeData> | undefined, metadata: input.metadata as CanvasNodeMetadata | undefined }];
    }
    if (name === "canvas_move_nodes") {
        return (input.items as Array<Record<string, unknown>>).map((item) => {
            const node = snapshot.nodes.find((candidate) => candidate.id === item.id);
            if (!node) throw new Error(`节点不存在：${String(item.id)}`);
            return {
                type: "update_node" as const,
                id: node.id,
                patch: {
                    position: {
                        x: numberOr(item.x, node.position.x + numberOr(item.dx, 0)),
                        y: numberOr(item.y, node.position.y + numberOr(item.dy, 0)),
                    },
                },
            };
        });
    }
    if (name === "canvas_resize_node") {
        return [{
            type: "update_node",
            id: String(input.id),
            patch: { width: Number(input.width), height: Number(input.height) },
            metadata: typeof input.freeResize === "boolean" ? { freeResize: input.freeResize } : undefined,
        }];
    }
    if (name === "canvas_delete_nodes") return [{ type: "delete_node", ids: input.ids as string[] }];
    if (name === "canvas_connect_nodes") {
        return (input.connections as Array<{ fromNodeId: string; toNodeId: string }>).map((connection) => ({ type: "connect_nodes", ...connection }));
    }
    if (name === "canvas_select_nodes") return [{ type: "select_nodes", ids: input.ids as string[] }];
    if (name === "canvas_set_viewport") return [{ type: "set_viewport", viewport: input.viewport as CanvasAgentSnapshot["viewport"] }];
    throw new Error(`工具不支持画布操作转换：${name}`);
}

function createTextNodes(input: ToolInput, snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
    const items = input.items as Array<Record<string, unknown>>;
    const startX = numberOr(input.x, nextCanvasX(snapshot));
    const startY = numberOr(input.y, 0);
    const gap = numberOr(input.gap, 40);
    const direction = input.direction === "row" ? "row" : "column";
    return items.map((item, index) => {
        const width = numberOr(item.width, 340);
        const height = numberOr(item.height, 240);
        return {
            type: "add_node",
            id: `text-${nanoid()}`,
            nodeType: "text",
            title: typeof item.title === "string" ? item.title : "文本",
            position: {
                x: numberOr(item.x, direction === "row" ? startX + index * (width + gap) : startX),
                y: numberOr(item.y, direction === "column" ? startY + index * (height + gap) : startY),
            },
            width,
            height,
            metadata: { content: String(item.text || ""), status: "success", fontSize: 14 },
        };
    });
}

function createGenerationFlow(input: ToolInput, snapshot: CanvasAgentSnapshot): CanvasAgentOp[] {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const promptNodeId = typeof input.promptNodeId === "string" ? input.promptNodeId : "";
    const promptNode = promptNodeId ? snapshot.nodes.find((node) => node.id === promptNodeId) : undefined;
    if (promptNodeId && !promptNode) throw new Error(`提示词节点不存在：${promptNodeId}`);
    if (promptNode && promptNode.type !== "text") throw new Error(`提示词节点必须是文本节点：${promptNodeId}`);
    const x = numberOr(input.x, promptNode ? promptNode.position.x + promptNode.width + 80 : nextCanvasX(snapshot));
    const y = numberOr(input.y, promptNode?.position.y || 0);
    const textId = `text-${nanoid()}`;
    const configId = `config-${nanoid()}`;
    const referenceNodeIds = Array.from(new Set(((input.referenceNodeIds as string[] | undefined) || []).filter((id) => id !== promptNodeId)));
    const knownIds = new Set(snapshot.nodes.map((node) => node.id));
    referenceNodeIds.forEach((id) => {
        if (!knownIds.has(id)) throw new Error(`引用节点不存在：${id}`);
    });
    const sourceTextId = promptNodeId || textId;
    const tokens = [`@[node:${sourceTextId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    return [
        ...(!promptNodeId ? [{
            type: "add_node",
            id: textId,
            nodeType: "text",
            title: typeof input.title === "string" ? input.title : "提示词",
            position: { x, y },
            metadata: { content: prompt, status: "success", fontSize: 14 },
        } satisfies CanvasAgentOp] : []),
        {
            type: "add_node",
            id: configId,
            nodeType: "config",
            title: generationTitle(mode),
            position: { x: promptNodeId ? x : x + 420, y },
            metadata: compactRecord({
                generationMode: mode,
                composerContent: tokens.join("\n"),
                prompt: tokens.join("\n"),
                status: "idle",
                model: input.model,
                size: input.size,
                quality: input.quality,
                count: input.count,
                seconds: input.seconds,
                vquality: input.vquality,
                generateAudio: input.generateAudio,
                watermark: input.watermark,
                audioVoice: input.audioVoice,
                audioFormat: input.audioFormat,
                audioSpeed: input.audioSpeed,
                audioInstructions: input.audioInstructions,
            }),
        },
        { type: "connect_nodes", fromNodeId: sourceTextId, toNodeId: configId },
        ...referenceNodeIds.map((fromNodeId): CanvasAgentOp => ({ type: "connect_nodes", fromNodeId, toNodeId: configId })),
        { type: "select_nodes", ids: [configId] },
    ];
}

function nextCanvasX(snapshot: CanvasAgentSnapshot) {
    return snapshot.nodes.reduce((right, node) => Math.max(right, node.position.x + node.width), -80) + 80;
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: ReturnType<typeof generationMode>) {
    return mode === "text" ? "文本生成" : mode === "video" ? "视频生成" : mode === "audio" ? "音频生成" : "图片生成";
}

function numberOr(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compactRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
