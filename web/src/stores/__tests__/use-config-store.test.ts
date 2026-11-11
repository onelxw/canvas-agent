import { describe, expect, it } from "vitest";

import { createModelChannel, defaultConfig, FIXED_CHANNEL_BASE_URL, normalizeSingleChannelConfig, resolveModelForCapability, resolveModelRequestConfig, useConfigStore, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

describe("fixed model channel", () => {
    it("keeps the original generation and selection defaults", () => {
        expect(defaultConfig.nodeRegenerateBehavior).toBe("new-node");
        expect(defaultConfig.autoFocusOnSelect).toBe(false);
        const config = normalizeSingleChannelConfig({ ...defaultConfig, nodeRegenerateBehavior: "overwrite", autoFocusOnSelect: true });
        expect(config.nodeRegenerateBehavior).toBe("overwrite");
        expect(config.autoFocusOnSelect).toBe(true);
        expect(config.baseUrl).toBe(FIXED_CHANNEL_BASE_URL);
        expect(config.channels).toHaveLength(1);
    });

    it("uses gpt-5.6-terra as the default text model", () => {
        expect(defaultConfig.textModel).toBe("default::gpt-5.6-terra");
        expect(defaultConfig.channels[0].models).toContainEqual({ name: "gpt-5.6-terra", capability: "text" });
    });

    it("replaces the legacy default video model with the three MiniMax H3 models", () => {
        const config = normalizeSingleChannelConfig({
            ...defaultConfig,
            videoModel: "default::grok-imagine-video",
            channels: [{ ...defaultConfig.channels[0], models: [{ name: "grok-imagine-video", capability: "video" }] }],
        });

        expect(config.videoModel).toBe("default::minimax-h3-文生视频");
        expect(config.channels[0].models.map((model) => model.name)).toEqual(["minimax-h3-文生视频", "minimax-h3-图生视频", "minimax-h3-多图多音频"]);
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

describe("unavailable model selections", () => {
    const config: AiConfig = {
        ...defaultConfig,
        imageModel: "default::image-a",
        videoModel: "default::video-a",
        channels: [createModelChannel({
            id: "default",
            apiKey: "test-key",
            models: [{ name: "image-a", capability: "image" }, { name: "video-a", capability: "video" }],
        })],
    };
    const ready = useConfigStore.getState().isAiConfigReady;

    it("preserves missing selections for every capability and blocks requests", () => {
        for (const capability of ["image", "video", "text", "audio"] as ModelCapability[]) {
            for (const model of [`default::deleted-${capability}`, `removed::${capability}`, `unknown-${capability}`]) {
                expect(resolveModelForCapability(config, model, capability)).toBe(model);
                expect(ready(config, model)).toBe(false);
            }
        }
    });

    it("does not substitute the default for the same model name on a removed channel", () => {
        const model = "removed::video-a";
        expect(resolveModelForCapability(config, model, "video")).toBe(model);
        expect(ready(config, model)).toBe(false);
    });

    it("preserves unavailable defaults through single-channel normalization", () => {
        const normalized = normalizeSingleChannelConfig({ ...config, imageModel: "default::deleted-image", textModel: "removed::text-a" });
        expect(normalized.imageModel).toBe("default::deleted-image");
        expect(normalized.textModel).toBe("removed::text-a");
        expect(normalized.channels).toHaveLength(1);
        expect(normalized.baseUrl).toBe(FIXED_CHANNEL_BASE_URL);
        expect(resolveModelForCapability(normalized, undefined, "image")).toBe("default::deleted-image");
        expect(ready(normalized, normalized.imageModel)).toBe(false);
    });

    it("uses the configured default for new nodes and when switching capability", () => {
        expect(resolveModelForCapability(config, undefined, "video")).toBe("default::video-a");
        expect(resolveModelForCapability(config, "default::image-a", "video")).toBe("default::video-a");
        expect(ready(config, "default::video-a")).toBe(true);
    });

    it("allows key rotation on the same channel but rejects an empty key", () => {
        expect(ready({ ...config, channels: [{ ...config.channels[0], apiKey: "rotated-key" }] }, config.videoModel)).toBe(true);
        expect(ready({ ...config, channels: [{ ...config.channels[0], apiKey: "" }] }, config.videoModel)).toBe(false);
    });
});
