import { zodToJsonSchema } from "zod-to-json-schema";

import { hasInternalAgentPermission, requiresInternalAgentConfirmation } from "../permissions";
import type { InternalAgentPermission, InternalAgentPermissionSettings, InternalAgentToolDefinition } from "../types";
import { internalAgentToolNames, internalAgentToolSchemas, type InternalAgentToolName } from "./schemas";

export type InternalAgentToolContext = {
    hasCanvas: boolean;
    projectId?: string;
    permissions: InternalAgentPermissionSettings;
};

export type InternalAgentRegisteredTool = {
    name: InternalAgentToolName;
    description: string;
    permission: InternalAgentPermission;
    schema: (typeof internalAgentToolSchemas)[InternalAgentToolName];
};

const descriptions: Record<InternalAgentToolName, string> = {
    canvas_get_state: "读取当前画布的项目 ID、revision、节点、连线、选区和视口。写入前必须使用最新状态。",
    canvas_get_selection: "读取当前画布选中的节点。",
    canvas_apply_ops: "批量修改当前画布。仅支持节点、连线、选区和视口操作，不会触发内容生成。",
    canvas_create_text_nodes: "在当前画布批量创建文本节点。",
    canvas_create_generation_flow: "创建提示词和生成配置流程并连接参考节点，但不会自动开始付费生成。",
    canvas_update_node: "更新当前画布中一个节点的安全字段。",
    canvas_move_nodes: "移动当前画布中的一个或多个节点。",
    canvas_resize_node: "调整当前画布中一个节点的尺寸。",
    canvas_delete_nodes: "删除当前画布中的指定节点及相关连线。",
    canvas_connect_nodes: "连接当前画布中的节点。",
    canvas_select_nodes: "设置当前画布选中的节点。",
    canvas_set_viewport: "设置当前画布视口。",
    canvas_run_generation: "在当前画布触发内容生成，可能产生费用。",
    generation_get_status: "查询当前画布生成节点的状态。",
};

const permissions: Record<InternalAgentToolName, InternalAgentPermission> = {
    canvas_get_state: "read",
    canvas_get_selection: "read",
    canvas_apply_ops: "canvas_write",
    canvas_create_text_nodes: "canvas_write",
    canvas_create_generation_flow: "canvas_write",
    canvas_update_node: "canvas_write",
    canvas_move_nodes: "canvas_write",
    canvas_resize_node: "canvas_write",
    canvas_delete_nodes: "canvas_write",
    canvas_connect_nodes: "canvas_write",
    canvas_select_nodes: "canvas_write",
    canvas_set_viewport: "canvas_write",
    canvas_run_generation: "generation",
    generation_get_status: "generation",
};

export const internalAgentToolRegistry: Record<InternalAgentToolName, InternalAgentRegisteredTool> = Object.fromEntries(
    internalAgentToolNames.map((name) => [name, { name, description: descriptions[name], permission: permissions[name], schema: internalAgentToolSchemas[name] }]),
) as Record<InternalAgentToolName, InternalAgentRegisteredTool>;

export function availableInternalAgentTools(context: InternalAgentToolContext): InternalAgentRegisteredTool[] {
    if (!context.hasCanvas) return [];
    return internalAgentToolNames.map((name) => internalAgentToolRegistry[name]).filter((tool) => hasInternalAgentPermission(context.permissions, tool.permission));
}

export function internalAgentModelTools(context: InternalAgentToolContext): InternalAgentToolDefinition[] {
    return availableInternalAgentTools(context).map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: modelJsonSchema(tool.schema),
    }));
}

function modelJsonSchema(schema: InternalAgentRegisteredTool["schema"]): Record<string, unknown> {
    const converted = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
    const { $schema: _schemaVersion, definitions: _definitions, ...parameters } = converted;
    return parameters;
}

export function internalAgentToolNeedsConfirmation(name: InternalAgentToolName, settings: InternalAgentPermissionSettings) {
    return requiresInternalAgentConfirmation(settings, internalAgentToolRegistry[name].permission);
}

export function parseInternalAgentToolInput(name: string, input: unknown) {
    const tool = internalAgentToolRegistry[name as InternalAgentToolName];
    if (!tool) throw new Error(`未注册工具：${name}`);
    return tool.schema.parse(input);
}
