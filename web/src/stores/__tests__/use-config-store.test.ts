import { describe, expect, it } from "vitest";

import { createModelChannel, defaultConfig, FIXED_CHANNEL_BASE_URL, normalizeSingleChannelConfig, resolveModelRequestConfig } from "@/stores/use-config-store";

describe("fixed model channel", () => {
    it("uses gpt-5.6-terra as the default text model", () => {
        expect(defaultConfig.textModel).toBe("default::gpt-5.6-terra");
        expect(defaultConfig.channels[0].models).toContainEqual({ name: "gpt-5.6-terra", capability: "text" });
    });

    it("always creates channels with the application endpoint", () => {
        const channel = createModelChannel({ baseUrl: "https://example.com", apiKey: "secret" });

        expect(channel.baseUrl).toBe(FIXED_CHANNEL_BASE_URL);
        expect(channel.apiKey).toBe("secret");
    });

    it("keeps only the first imported channel and normalizes model requests", () => {
        const config = normalizeSingleChannelConfig({
            ...defaultConfig,
            channels: [
                { ...defaultConfig.channels[0], baseUrl: "https://first.example.com", apiKey: "first-key" },
                { ...defaultConfig.channels[0], id: "second", baseUrl: "https://second.example.com", apiKey: "second-key" },
            ],
        });

        expect(config.channels).toHaveLength(1);
        expect(config.channels[0].apiKey).toBe("first-key");
        expect(config.channels[0].baseUrl).toBe(FIXED_CHANNEL_BASE_URL);
        expect(resolveModelRequestConfig(config, config.textModel).baseUrl).toBe(FIXED_CHANNEL_BASE_URL);
    });
});
