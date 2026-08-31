import type { InternalAgentLimits } from "./types";
import type { InternalAgentTransportMessage } from "@/services/api/internal-agent/types";

const SECRET_KEYS = /(^|_)(api[_-]?key|authorization|password|token|secret)($|_)/i;

export function sanitizeInternalAgentValue(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return value;
    if (typeof value !== "object") return String(value);
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.map((item) => sanitizeInternalAgentValue(item, seen));
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? "[REDACTED]" : sanitizeInternalAgentValue(item, seen)]),
    );
}

export function serializeInternalAgentResult(value: unknown, maxChars: number): string {
    let serialized: string;
    try {
        serialized = JSON.stringify(sanitizeInternalAgentValue(value));
    } catch {
        serialized = JSON.stringify({ ok: false, error: "工具结果无法序列化" });
    }
    return truncateInternalAgentText(serialized, maxChars);
}

export function truncateInternalAgentText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    const suffix = `\n…[已截断 ${value.length - maxChars} 个字符]`;
    return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

export function trimInternalAgentContext(messages: InternalAgentTransportMessage[], limits: InternalAgentLimits): InternalAgentTransportMessage[] {
    if (!messages.length) return [];
    const system = messages[0]?.role === "system" ? messages[0] : undefined;
    const candidates = system ? messages.slice(1) : messages;
    const selected: InternalAgentTransportMessage[] = [];
    let chars = system ? messageSize(system) : 0;
    const allowed = Math.max(0, limits.maxContextMessages - (system ? 1 : 0));

    for (let index = candidates.length - 1; index >= 0 && selected.length < allowed; index -= 1) {
        const message = candidates[index];
        const size = messageSize(message);
        if (selected.length && chars + size > limits.maxContextChars) break;
        selected.unshift({
            ...message,
            content: message.role === "tool" ? truncateInternalAgentText(message.content, limits.maxToolResultChars) : message.content,
        });
        chars += Math.min(size, message.role === "tool" ? limits.maxToolResultChars : size);
    }

    while (selected[0]?.role === "tool") selected.shift();
    return system ? [system, ...selected] : selected;
}

function messageSize(message: InternalAgentTransportMessage) {
    return message.content.length + (message.toolCalls?.reduce((sum, call) => sum + call.name.length + call.arguments.length, 0) || 0);
}
