import { describe, expect, it } from "vitest";
import { getThumbnailDimensions, pickImageSource } from "@/lib/image-thumbnail";

describe("image preview selection", () => {
    const image = { previewUrl: "preview.webp", originalUrl: "original.png", naturalWidth: 4000, naturalHeight: 3000, renderedWidth: 420, renderedHeight: 315, scale: 1, devicePixelRatio: 1 };

    it("uses previews for small surfaces and originals for enlarged or high-DPI surfaces", () => {
        expect(pickImageSource(image)).toBe(image.previewUrl);
        expect(pickImageSource({ ...image, scale: 3 })).toBe(image.originalUrl);
        expect(pickImageSource({ ...image, devicePixelRatio: 2 })).toBe(image.originalUrl);
        expect(pickImageSource({ ...image, previewUrl: undefined })).toBe(image.originalUrl);
    });

    it("preserves landscape and portrait proportions without upscaling small images", () => {
        expect(getThumbnailDimensions(4000, 3000)).toEqual({ width: 768, height: 576 });
        expect(getThumbnailDimensions(3000, 4000)).toEqual({ width: 576, height: 768 });
        expect(getThumbnailDimensions(320, 240)).toEqual({ width: 320, height: 240 });
    });
});
