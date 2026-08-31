import type { InternalAgentPermission, InternalAgentPermissionSettings } from "./types";

export function hasInternalAgentPermission(settings: InternalAgentPermissionSettings, permission: InternalAgentPermission) {
    return settings[permission];
}

export function requiresInternalAgentConfirmation(settings: InternalAgentPermissionSettings, permission: InternalAgentPermission) {
    if (permission === "read") return false;
    if (permission === "generation") return !settings.autoConfirmGeneration;
    return !settings.autoConfirmCanvasWrite;
}
