import { describe, expect, it } from "vitest";

import { sanitizeInternalAgentValue, serializeInternalAgentResult, trimInternalAgentContext } from "../context";
import { DEFAULT_INTERNAL_AGENT_LIMITS } from "../types";

describe("internal Agent context", () => {
    it("redacts secret-shaped fields", () => {
        expect(sanitizeInternalAgentValue({ apiKey: "secret", nested: { access_token: "secret-2", value: "safe" } })).toEqual({ apiKey: "[REDACTED]", nested: { access_token: "[REDACTED]", value: "safe" } });
    });

    it("truncates tool results and context", () => {
        expect(serializeInternalAgentResult({ content: "x".repeat(100) }, 40).length).toBeLessThanOrEqual(40);
        const messages = [
            { role: "system" as const, content: "system" },
            ...Array.from({ length: 10 }, (_, index) => ({ role: "user" as const, content: `${index}`.repeat(20) })),
        ];
        const result = trimInternalAgentContext(messages, { ...DEFAULT_INTERNAL_AGENT_LIMITS, maxContextMessages: 4, maxContextChars: 80 });
        expect(result[0].role).toBe("system");
        expect(result.length).toBeLessThanOrEqual(4);
    });
});
