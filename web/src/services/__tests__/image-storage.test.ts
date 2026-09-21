import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    stores: new Map<string, Map<string, unknown>>(),
    thumbnail: vi.fn(),
}));

vi.mock("localforage", () => ({
    default: {
        createInstance: ({ storeName }: { storeName: string }) => {
            const data = new Map<string, unknown>();
            mocks.stores.set(storeName, data);
            return {
                getItem: async (key: string) => data.get(key) ?? null,
                setItem: async (key: string, value: unknown) => { data.set(key, value); return value; },
                removeItem: async (key: string) => { data.delete(key); },
                iterate: async (callback: (value: unknown, key: string) => void) => { data.forEach(callback); },
            };
        },
    },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/lib/image-thumbnail", () => ({ createImageThumbnail: mocks.thumbnail }));

beforeEach(() => {
    vi.resetModules();
    mocks.stores.clear();
    mocks.thumbnail.mockReset();
    mocks.thumbnail.mockResolvedValue(new Blob(["preview"], { type: "image/webp" }));
});

describe("local image previews", () => {
    it("deduplicates concurrent requests while keeping the original blob intact", async () => {
        const storage = await import("@/services/image-storage");
        const original = new Blob(["original"], { type: "image/png" });
        mocks.stores.get("image_files")!.set("image:one", original);
        const listener = vi.fn();
        const unsubscribe = storage.subscribeImagePreviews(listener);
        const urls = await Promise.all(Array.from({ length: 8 }, () => storage.ensureImagePreview("image:one")));
        expect(new Set(urls).size).toBe(1);
        expect(urls[0]).toMatch(/^blob:/);
        expect(mocks.thumbnail).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(await storage.getImageBlob("image:one")).toBe(original);
        expect(mocks.stores.get("image_previews")!.size).toBe(1);
        unsubscribe();
        await storage.deleteStoredImages(["image:one"]);
    });

    it("loads persisted previews without decoding the original again", async () => {
        const storage = await import("@/services/image-storage");
        mocks.stores.get("image_previews")!.set("image:cached", { version: 1, blob: new Blob(["cached"]) });
        expect(await storage.ensureImagePreview("image:cached")).toMatch(/^blob:/);
        expect(mocks.thumbnail).not.toHaveBeenCalled();
        await storage.deleteStoredImages(["image:cached"]);
    });

    it("does not regenerate previews for small images", async () => {
        const storage = await import("@/services/image-storage");
        mocks.thumbnail.mockResolvedValue(undefined);
        mocks.stores.get("image_files")!.set("image:small", new Blob(["small"]));
        await storage.ensureImagePreview("image:small");
        await storage.ensureImagePreview("image:small");
        expect(storage.previewUrlFor("image:small")).toBeUndefined();
        expect(mocks.thumbnail).toHaveBeenCalledTimes(1);
    });

    it("does not leave a preview behind when deleting during generation", async () => {
        const storage = await import("@/services/image-storage");
        let complete!: (blob: Blob) => void;
        let started!: () => void;
        const began = new Promise<void>((resolve) => { started = resolve; });
        mocks.thumbnail.mockImplementation(() => {
            started();
            return new Promise<Blob>((resolve) => { complete = resolve; });
        });
        mocks.stores.get("image_files")!.set("image:deleting", new Blob(["original"]));
        const pending = storage.ensureImagePreview("image:deleting");
        await began;
        const deleting = storage.deleteStoredImages(["image:deleting"]);
        complete(new Blob(["preview"]));
        await Promise.all([pending, deleting]);
        expect(storage.previewUrlFor("image:deleting")).toBeUndefined();
        expect(mocks.stores.get("image_previews")!.has("image:deleting")).toBe(false);
        expect(await storage.getImageBlob("image:deleting")).toBeNull();
    });

    it("invalidates previews when an imported original replaces the stored image", async () => {
        const storage = await import("@/services/image-storage");
        const before = new Blob(["before"]);
        const after = new Blob(["after"]);
        mocks.stores.get("image_files")!.set("image:replace", before);
        const first = await storage.ensureImagePreview("image:replace");
        await storage.setImageBlob("image:replace", after);
        expect(storage.previewUrlFor("image:replace")).not.toBe(first);
        expect(mocks.thumbnail).toHaveBeenLastCalledWith(after);
        expect(await storage.getImageBlob("image:replace")).toBe(after);
        await storage.deleteStoredImages(["image:replace"]);
    });
});
