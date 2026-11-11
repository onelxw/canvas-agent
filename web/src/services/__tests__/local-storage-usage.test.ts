import { afterEach, describe, expect, it, vi } from "vitest";

import { readLocalStorageUsage } from "@/services/local-storage-usage";

afterEach(() => vi.unstubAllGlobals());

// One IndexedDB store with a real Blob payload; no Storage API dependency.
function stubDatabase() {
    const close = vi.fn();
    vi.stubGlobal("indexedDB", {
        open: vi.fn(() => {
            const request = {
                onsuccess: () => {},
                result: {
                    version: 1,
                    objectStoreNames: ["image_files"],
                    close,
                    transaction: () => ({ objectStore: () => ({
                        name: "image_files",
                        openCursor: () => {
                            const cursor = { onsuccess: () => {}, result: null as unknown };
                            queueMicrotask(() => {
                                cursor.result = { value: new Blob(["image"]), continue: () => {
                                    cursor.result = null;
                                    queueMicrotask(() => cursor.onsuccess());
                                } };
                                cursor.onsuccess();
                            });
                            return cursor;
                        },
                    }) }),
                },
            };
            queueMicrotask(() => request.onsuccess());
            return request;
        }),
    });
    return close;
}

describe("local storage usage without quota estimates", () => {
    it.each([undefined, {}, { storage: {} }, { storage: { estimate: vi.fn().mockRejectedValue(new Error("unavailable")) } }])("still reads IndexedDB when navigator is %j", async (navigator) => {
        vi.stubGlobal("navigator", navigator);
        const close = stubDatabase();
        const usage = await readLocalStorageUsage();
        expect(usage).toMatchObject({ usage: 5, quota: null, contentBytes: 5 });
        expect(usage.databases[0].stores).toEqual([{ name: "image_files", records: 1, bytes: 5 }]);
        expect(close).toHaveBeenCalledOnce();
    });

    it("uses browser totals when estimates are available", async () => {
        vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 100, quota: 1000 }) } });
        stubDatabase();
        expect(await readLocalStorageUsage()).toMatchObject({ usage: 100, quota: 1000, contentBytes: 5 });
    });
});
