import { describe, expect, it } from "vitest";

import { buildMinimaxH3RequestBody, clampMinimaxH3Seconds, minimaxH3AspectRatio, minimaxH3Kind, minimaxH3Resolution } from "@/lib/minimax-h3-video";

describe("MiniMax H3 video settings", () => {
    it("derives the reference behavior from the model name", () => {
        expect(minimaxH3Kind("default::minimax-h3-文生视频")).toBe("text");
        expect(minimaxH3Kind("minimax-h3-图生视频")).toBe("image");
        expect(minimaxH3Kind("minimax-h3-多图多音频")).toBe("multi");
        expect(minimaxH3Kind("other-video-model")).toBeNull();
    });

    it("normalizes supported resolution, ratio and duration values", () => {
        expect(minimaxH3Resolution("768p")).toBe("768P");
        expect(minimaxH3Resolution("1080")).toBe("480P");
        expect(minimaxH3AspectRatio("1280x720")).toBe("horizontal");
        expect(minimaxH3AspectRatio("720x1280")).toBe("vertical");
        expect(minimaxH3AspectRatio("1:1")).toBe("vertical");
        expect(clampMinimaxH3Seconds("0")).toBe("1");
        expect(clampMinimaxH3Seconds("20")).toBe("15");
        expect(clampMinimaxH3Seconds("bad")).toBe("5");
    });

    it("builds the documented JSON body without legacy video fields", () => {
        const body = buildMinimaxH3RequestBody({
            model: "default::minimax-h3-多图多音频",
            prompt: " test ",
            seconds: "20",
            resolution: "768p",
            size: "1280x720",
            imageUrls: ["https://example.com/a.png"],
            audioUrls: ["https://example.com/a.mp3"],
        });
        expect(body).toEqual({
            model: "minimax-h3-多图多音频",
            prompt: "test",
            duration: 15,
            resolution: "768P",
            aspect_ratio: "horizontal",
            reference_images: [{ url: "https://example.com/a.png", role: "reference_image" }],
            reference_audios: [{ url: "https://example.com/a.mp3" }],
        });
        expect(body).not.toHaveProperty("mode");
        expect(body).not.toHaveProperty("reference_videos");
        expect(body).not.toHaveProperty("generate_audio");
        expect(body).not.toHaveProperty("negative_prompt");
    });
});
