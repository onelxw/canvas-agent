import { z } from "zod";

const idSchema = z.string().trim().min(1).max(200);
const projectWriteSchema = {
    projectId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
};
const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const viewportSchema = z.object({ x: z.number().finite(), y: z.number().finite(), k: z.number().finite().positive() }).strict();
const generationModeSchema = z.enum(["text", "image", "video", "audio"]);
const nodeTypeSchema = z.enum(["image", "text", "config", "video", "audio"]);

const safeMetadataSchema = z
    .object({
        content: z.string().max(100_000).optional(),
        composerContent: z.string().max(100_000).optional(),
        prompt: z.string().max(100_000).optional(),
        fontSize: z.number().finite().positive().optional(),
        generationMode: generationModeSchema.optional(),
        model: z.string().max(300).optional(),
        size: z.string().max(100).optional(),
        quality: z.string().max(100).optional(),
        count: z.number().int().positive().optional(),
        seconds: z.string().max(50).optional(),
        vquality: z.string().max(50).optional(),
        generateAudio: z.string().max(20).optional(),
        watermark: z.string().max(20).optional(),
        audioVoice: z.string().max(100).optional(),
        audioFormat: z.string().max(50).optional(),
        audioSpeed: z.string().max(50).optional(),
        audioInstructions: z.string().max(10_000).optional(),
        freeResize: z.boolean().optional(),
    })
    .strict();

const nodePatchSchema = z
    .object({
        title: z.string().max(500).optional(),
        position: positionSchema.optional(),
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
    })
    .strict();

export const internalCanvasOpSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), nodeType: nodeTypeSchema, id: idSchema.optional(), title: z.string().max(500).optional(), position: positionSchema, width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional(), metadata: safeMetadataSchema.optional() }).strict(),
    z.object({ type: z.literal("update_node"), id: idSchema, patch: nodePatchSchema.optional(), metadata: safeMetadataSchema.optional() }).strict(),
    z.object({ type: z.literal("delete_node"), ids: z.array(idSchema).min(1) }).strict(),
    z.object({ type: z.literal("delete_connections"), ids: z.array(idSchema).optional(), all: z.boolean().optional() }).strict(),
    z.object({ type: z.literal("connect_nodes"), id: idSchema.optional(), fromNodeId: idSchema, toNodeId: idSchema }).strict(),
    z.object({ type: z.literal("set_viewport"), viewport: viewportSchema }).strict(),
    z.object({ type: z.literal("select_nodes"), ids: z.array(idSchema) }).strict(),
]);

const generationOptionsSchema = {
    model: z.string().max(300).optional(),
    size: z.string().max(100).optional(),
    quality: z.string().max(100).optional(),
    count: z.number().int().positive().optional(),
    seconds: z.string().max(50).optional(),
    vquality: z.string().max(50).optional(),
    generateAudio: z.string().max(20).optional(),
    watermark: z.string().max(20).optional(),
    audioVoice: z.string().max(100).optional(),
    audioFormat: z.string().max(50).optional(),
    audioSpeed: z.string().max(50).optional(),
    audioInstructions: z.string().max(10_000).optional(),
};

export const internalAgentToolSchemas = {
    canvas_get_state: z.object({}).strict(),
    canvas_get_selection: z.object({}).strict(),
    canvas_apply_ops: z.object({ ...projectWriteSchema, ops: z.array(internalCanvasOpSchema).min(1) }).strict(),
    canvas_create_text_nodes: z.object({ ...projectWriteSchema, items: z.array(z.object({ text: z.string().max(100_000), title: z.string().max(500).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional() }).strict()).min(1), x: z.number().finite().optional(), y: z.number().finite().optional(), gap: z.number().finite().nonnegative().optional(), direction: z.enum(["row", "column"]).optional() }).strict(),
    canvas_create_generation_flow: z.object({ ...projectWriteSchema, prompt: z.string().max(100_000).optional(), promptNodeId: idSchema.optional(), title: z.string().max(500).optional(), mode: generationModeSchema.optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), referenceNodeIds: z.array(idSchema).optional(), ...generationOptionsSchema }).strict(),
    canvas_update_node: z.object({ ...projectWriteSchema, id: idSchema, patch: nodePatchSchema.optional(), metadata: safeMetadataSchema.optional() }).strict(),
    canvas_move_nodes: z.object({ ...projectWriteSchema, items: z.array(z.object({ id: idSchema, x: z.number().finite().optional(), y: z.number().finite().optional(), dx: z.number().finite().optional(), dy: z.number().finite().optional() }).strict()).min(1) }).strict(),
    canvas_resize_node: z.object({ ...projectWriteSchema, id: idSchema, width: z.number().finite().positive(), height: z.number().finite().positive(), freeResize: z.boolean().optional() }).strict(),
    canvas_delete_nodes: z.object({ ...projectWriteSchema, ids: z.array(idSchema).min(1) }).strict(),
    canvas_connect_nodes: z.object({ ...projectWriteSchema, connections: z.array(z.object({ fromNodeId: idSchema, toNodeId: idSchema }).strict()).min(1) }).strict(),
    canvas_select_nodes: z.object({ ...projectWriteSchema, ids: z.array(idSchema) }).strict(),
    canvas_set_viewport: z.object({ ...projectWriteSchema, viewport: viewportSchema }).strict(),
    canvas_run_generation: z.object({ ...projectWriteSchema, nodeId: idSchema, mode: generationModeSchema.optional(), prompt: z.string().max(100_000).optional() }).strict(),
    generation_get_status: z.object({ projectId: idSchema, nodeIds: z.array(idSchema).optional(), limit: z.number().int().positive().optional() }).strict(),
} as const;

export type InternalAgentToolName = keyof typeof internalAgentToolSchemas;
export type InternalAgentToolInput<Name extends InternalAgentToolName> = z.infer<(typeof internalAgentToolSchemas)[Name]>;

export const internalAgentToolNames = Object.keys(internalAgentToolSchemas) as InternalAgentToolName[];
