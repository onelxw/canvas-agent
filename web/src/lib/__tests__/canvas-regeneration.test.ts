import { describe, expect, it } from "vitest";

import { replaceGeneratedNode } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("regenerating an existing canvas node", () => {
    it.each([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text])("clears the previous %s output while preserving group and editor state", (type) => {
        const source: CanvasNodeData = {
            id: "existing", type, title: "Old result", position: { x: 12, y: 34 }, width: 340, height: 240,
            metadata: {
                groupId: "group", freeResize: true, composerContent: "new prompt",
                content: "old-url", storageKey: "old-file", naturalWidth: 2000, naturalHeight: 1000,
                bytes: 500, mimeType: "old/type", durationMs: 10000,
                primaryImageId: "old-image", images: [{ id: "old-image", status: "success", content: "old-url", naturalWidth: 2000, naturalHeight: 1000, bytes: 500, mimeType: "image/png" }],
                primaryTextId: "old-text", texts: [{ id: "old-text", status: "success", content: "old text" }],
                videoTaskId: "old-task", videoTaskProvider: "gateway", videoTaskCompleted: true,
                videoTaskResultUrl: "old-result", videoTaskFailed: true, errorDetails: "old error",
            },
        };
        const replacement: CanvasNodeData = {
            ...source, title: "New result",
            metadata: { prompt: "new prompt", status: "loading", model: "default::new-model" },
        };
        const result = replaceGeneratedNode(source, replacement);
        expect(result.id).toBe(source.id);
        expect(result.position).toEqual(source.position);
        expect(result.metadata).toEqual({
            groupId: "group", freeResize: true, composerContent: "new prompt",
            prompt: "new prompt", status: "loading", model: "default::new-model",
        });
        expect(source.metadata?.videoTaskId).toBe("old-task");
        expect(source.metadata?.content).toBe("old-url");
    });

    it("replaces old image slots and primary selection with a fresh batch", () => {
        const source: CanvasNodeData = {
            id: "image", type: CanvasNodeType.Image, title: "Image", position: { x: 0, y: 0 }, width: 340, height: 240,
            metadata: { primaryImageId: "old-primary", storageKey: "old-file", content: "old-url" },
        };
        const images = [{ id: "new-slot", status: "loading" as const, content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }];
        const result = replaceGeneratedNode(source, { ...source, metadata: { status: "loading", images, primaryImageId: undefined } });
        expect(result.metadata?.images).toEqual(images);
        expect(result.metadata?.primaryImageId).toBeUndefined();
        expect(result.metadata?.content).toBeUndefined();
        expect(result.metadata?.storageKey).toBeUndefined();
    });
});
