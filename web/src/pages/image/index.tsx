import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { WorkbenchScrollArea } from "@/components/workbench-scroll-area";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { deleteStoredImages, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
};

type GenerationBatch = {
    id: string;
    createdAt: number;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    status: "pending" | "success" | "failed";
    results: GenerationResult[];
};

type GenerationLog = {
    id: string;
    createdAt: number;
    updatedAt: number;
    title: string;
    time: string;
    batches: GenerationBatch[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    status: "pending" | "success" | "failed";
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export default function ImagePage() {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [activeLogId, setActiveLogId] = useState<string | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const logsRef = useRef<GenerationLog[]>([]);
    const activeLogIdRef = useRef<string | null>(null);
    const persistQueuesRef = useRef(new Map<string, Promise<void>>());

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const activeLog = logs.find((log) => log.id === activeLogId) || null;
    const activeResults = activeLog ? flattenLogResults(activeLog) : [];
    const activePendingCount = activeResults.filter(({ result }) => result.status === "pending").length;

    useEffect(() => {
        void refreshLogs();
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("imageWorkbench.clipboardEmpty"));
        }
    };

    const persistLog = (log: GenerationLog) => {
        const previous = persistQueuesRef.current.get(log.id) || Promise.resolve();
        let next: Promise<void>;
        next = previous
            .catch(() => undefined)
            .then(() => logStore.setItem(log.id, serializeLog(log)))
            .then(() => undefined)
            .finally(() => {
                if (persistQueuesRef.current.get(log.id) === next) persistQueuesRef.current.delete(log.id);
            });
        persistQueuesRef.current.set(log.id, next);
    };

    const replaceLogs = (nextLogs: GenerationLog[]) => {
        logsRef.current = nextLogs;
        setLogs(nextLogs);
    };

    const addLog = (log: GenerationLog) => {
        replaceLogs([log, ...logsRef.current]);
        persistLog(log);
    };

    const updateLog = (logId: string, updater: (log: GenerationLog) => GenerationLog) => {
        const current = logsRef.current.find((log) => log.id === logId);
        if (!current) return;
        const updated = summarizeLog({ ...updater(current), updatedAt: Date.now() });
        replaceLogs(logsRef.current.map((log) => (log.id === logId ? updated : log)));
        persistLog(updated);
    };

    const generate = () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        const batch = buildBatch({ prompt: text, model, config: { ...snapshot.config, count: String(generationCount) }, references: snapshot.references, count: generationCount });
        let logId = activeLogIdRef.current;
        const currentLog = logId ? logsRef.current.find((log) => log.id === logId) : undefined;
        if (currentLog) {
            updateLog(currentLog.id, (log) => ({ ...log, batches: [...log.batches, batch] }));
            setSelectedLogIds((ids) => ids.filter((id) => id !== currentLog.id));
        } else {
            const log = buildLog(batch);
            logId = log.id;
            activeLogIdRef.current = log.id;
            setActiveLogId(log.id);
            addLog(log);
        }
        void runGenerationBatch(logId!, batch, snapshot, agentTaskId);
    };

    const runGenerationBatch = async (logId: string, batch: GenerationBatch, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, agentTaskId?: string) => {
        const batchStartedAt = performance.now();
        const settled = await Promise.allSettled(batch.results.map((result) => runGenerationSlot(logId, batch.id, result.id, snapshot)));
        const successCount = settled.filter((item) => item.status === "fulfilled").length;
        const failCount = settled.length - successCount;
        const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
        updateLog(logId, (log) => ({
            ...log,
            batches: log.batches.map((item) => (item.id === batch.id ? summarizeBatch({ ...item, durationMs: performance.now() - batchStartedAt }) : item)),
        }));
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });
        successCount ? message.success(t("imageWorkbench.generated")) : message.error(error || t("workbench.generationFailed"));
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand]);

    useEffect(() => {
        if (!autoRunToken) return;
        generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number, sourcePrompt: string) => {
        const stored = await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: t("imageWorkbench.resultTitle", { count: index + 1 }),
            coverUrl: stored.url,
            tags: [],
            source: t("imageWorkbench.source"),
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt: sourcePrompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning(t("imageWorkbench.unsupportedAsset"));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setSelectedLogIds([]);
        activeLogIdRef.current = null;
        setActiveLogId(null);
        setLogsOpen(false);
    };

    const deleteSelectedLogs = () => {
        const selectedLogs = logsRef.current.filter((log) => selectedLogIds.includes(log.id) && log.status !== "pending");
        const ids = selectedLogs.map((log) => log.id);
        const imageKeys = selectedLogs.flatMap((log) => log.batches.flatMap((batch) => batch.results.map((result) => result.image?.storageKey).filter((key): key is string => Boolean(key))));
        replaceLogs(logsRef.current.filter((log) => !ids.includes(log.id)));
        void Promise.all([
            deleteStoredImages(imageKeys),
            ...ids.map(async (id) => {
                await persistQueuesRef.current.get(id)?.catch(() => undefined);
                await logStore.removeItem(id);
            }),
        ]);
        if (activeLogIdRef.current && ids.includes(activeLogIdRef.current)) {
            activeLogIdRef.current = null;
            setActiveLogId(null);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const refreshLogs = async () => {
        const storedLogs = await readStoredLogs();
        const currentIds = new Set(logsRef.current.map((log) => log.id));
        replaceLogs([...logsRef.current, ...storedLogs.filter((log) => !currentIds.has(log.id))].sort((a, b) => b.createdAt - a.createdAt));
    };

    const previewGenerationLog = (log: GenerationLog) => {
        activeLogIdRef.current = log.id;
        setActiveLogId(log.id);
        setLogsOpen(false);
        const batch = log.batches.at(-1);
        if (!batch) return;
        setPrompt(batch.prompt);
        setReferences(batch.references || []);
        if (batch.config.imageModel || batch.model) updateConfig("imageModel", batch.config.imageModel || batch.model);
        if (batch.config.quality) updateConfig("quality", batch.config.quality);
        if (batch.config.size) updateConfig("size", batch.config.size);
        if (batch.config.count) updateConfig("count", batch.config.count);
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (logId: string, batchId: string, resultId: string, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
        const itemStartedAt = performance.now();
        try {
            const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(snapshot.config, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const stored = await uploadImage(image.dataUrl);
            const nextImage: GeneratedImage = { id: image.id, dataUrl: stored.url, ...(stored.storageKey ? { storageKey: stored.storageKey } : {}), durationMs: performance.now() - itemStartedAt, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
            updateLog(logId, (log) => updateBatchResult(log, batchId, resultId, { status: "success", image: nextImage, error: undefined }));
            return nextImage;
        } catch (error) {
            updateLog(logId, (log) => updateBatchResult(log, batchId, resultId, { status: "failed", image: undefined, error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (logId: string, batchId: string, resultId: string) => {
        const batch = logsRef.current.find((log) => log.id === logId)?.batches.find((item) => item.id === batchId);
        if (!batch) return;
        const retryConfig = { ...effectiveConfig, ...batch.config, model: batch.model, imageModel: batch.model, count: "1" };
        if (!isAiConfigReady(retryConfig, batch.model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return;
        }
        const snapshot = { text: batch.prompt, config: retryConfig, references: [...batch.references] };
        setSelectedLogIds((ids) => ids.filter((id) => id !== logId));
        updateLog(logId, (log) => updateBatchResult(log, batchId, resultId, { status: "pending", error: undefined, image: undefined }));
        const retryStartedAt = performance.now();
        try {
            await runGenerationSlot(logId, batchId, resultId, snapshot);
            updateLog(logId, (log) => ({ ...log, batches: log.batches.map((item) => (item.id === batchId ? { ...item, durationMs: item.durationMs + performance.now() - retryStartedAt } : item)) }));
            message.success(t("workbench.retrySuccess"));
        } catch {
            // runGenerationSlot has already marked the result as failed.
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <WorkbenchScrollArea className="hidden min-h-0 rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:block" viewportClassName="h-full overflow-y-auto p-4">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={activeLogId || undefined}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                    />
                </WorkbenchScrollArea>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <WorkbenchScrollArea className="rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0" viewportClassName="flex flex-col p-4 lg:h-full lg:overflow-y-auto">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("imageWorkbench.title")}</h1>
                                </div>
                                <div className="flex shrink-0 gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        {t("workbench.logs")}
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        {t("workbench.settings")}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("imageWorkbench.references")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`hover-scrollbar relative flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-auto overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${isReferenceDragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current += 1;
                                        if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                        if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = 0;
                                        setIsReferenceDragActive(false);
                                        void addReferences(event.dataTransfer.files);
                                    }}
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label={t("imageWorkbench.removeReference")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">{isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {effectiveConfig.size} · {effectiveConfig.quality}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("workbench.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={generate}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </WorkbenchScrollArea>

                    <WorkbenchScrollArea className="rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0" viewportClassName="p-4 lg:h-full lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            </div>
                            {activePendingCount ? <Tag className="m-0 px-2 py-1" color="processing">{t("workbench.generatingCount", { count: activePendingCount })}</Tag> : null}
                        </div>
                        {activeResults.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                {activeResults.map(({ batch, result }, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={(image, imageIndex) => saveResultToAssets(image, imageIndex, batch.prompt)} />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={() => void retryResult(activeLog!.id, batch.id, result.id)} />
                                    ) : (
                                        <PendingImageCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("imageWorkbench.empty")} />
                            </div>
                        )}
                    </WorkbenchScrollArea>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={activeLogId || undefined}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                />
            </Drawer>
            <Drawer title={t("workbench.settings")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} variant="workbench" />
            </div>
        </>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <Image src={previewUrlFor(image.storageKey) || image.dataUrl} preview={{ src: image.dataUrl }} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-square object-cover" />
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title={t("common.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("common.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const selectableLogs = logs.filter((log) => log.status !== "pending");
    const allSelected = Boolean(selectableLogs.length) && selectableLogs.every((log) => selectedLogIds.includes(log.id));
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : selectableLogs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                </div>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!selectableLogs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        selectable={log.status !== "pending"}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, selectable, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; selectable: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const thumbnails = log.batches.flatMap((batch) => batch.results.flatMap((result) => result.image?.dataUrl ? [result.image] : [])).slice(0, 4);
    const pendingCount = log.imageCount - log.successCount - log.failCount;

    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} disabled={!selectable} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <img key={`${log.id}-${index}`} src={previewUrlFor(image.storageKey) || image.dataUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <div className="flex gap-1">
                        {pendingCount ? <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="processing">{t("workbench.generatingCount", { count: pendingCount })}</Tag> : null}
                        {log.successCount ? <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">{t("workbench.successCount", { count: log.successCount })}</Tag> : null}
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                {t("workbench.failCount", { count: log.failCount })}
                            </Tag>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{t("workbench.itemCount", { count: log.imageCount })}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.filter((log) => log.batches.length).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const batches = await Promise.all((log.batches || []).map(normalizeBatch));
    return summarizeLog({
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        updatedAt: log.updatedAt || log.createdAt || Date.now(),
        title: log.title || i18n.t("workbench.untitled"),
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        batches,
        durationMs: 0,
        successCount: 0,
        failCount: 0,
        imageCount: 0,
        status: "failed",
    });
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        batches: log.batches.map((batch) => ({
            ...batch,
            references: batch.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
            results: batch.results.map((result) => ({ ...result, image: result.image ? { ...result.image, dataUrl: result.image.storageKey ? "" : result.image.dataUrl } : undefined })),
        })),
    };
}

async function normalizeBatch(batch: GenerationBatch): Promise<GenerationBatch> {
    const references = await Promise.all(batch.references.map(async (item) => ({ ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) })));
    const results = await Promise.all(
        batch.results.map(async (result) =>
            result.status === "pending"
                ? { ...result, status: "failed" as const, error: i18n.t("imageWorkbench.interrupted") }
                : { ...result, image: result.image ? { ...result.image, dataUrl: await resolveImageUrl(result.image.storageKey, result.image.dataUrl) } : undefined },
        ),
    );
    return summarizeBatch({ ...batch, references, results });
}

function normalizeBatchConfig(config: Partial<GenerationLogConfig>, model = ""): GenerationLogConfig {
    return {
        model: config.model || model,
        imageModel: config.imageModel || model,
        quality: config.quality || "",
        size: config.size || "",
        count: config.count || "1",
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function buildBatch({
    prompt,
    model,
    config,
    references,
    count,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    count: number;
}): GenerationBatch {
    return summarizeBatch({
        id: nanoid(),
        createdAt: Date.now(),
        prompt,
        model,
        config: normalizeBatchConfig(config, model),
        references,
        durationMs: 0,
        status: "pending",
        results: Array.from({ length: count }, () => ({ id: nanoid(), status: "pending" as const })),
    });
}

function buildLog(batch: GenerationBatch): GenerationLog {
    return summarizeLog({
        id: nanoid(),
        createdAt: batch.createdAt,
        updatedAt: batch.createdAt,
        title: batch.prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        time: new Date(batch.createdAt).toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        batches: [batch],
        durationMs: 0,
        successCount: 0,
        failCount: 0,
        imageCount: batch.results.length,
        status: "pending",
    });
}

function summarizeBatch(batch: GenerationBatch): GenerationBatch {
    const pending = batch.results.some((result) => result.status === "pending");
    const success = batch.results.some((result) => result.status === "success");
    return { ...batch, status: pending ? "pending" : success ? "success" : "failed" };
}

function summarizeLog(log: GenerationLog): GenerationLog {
    const results = log.batches.flatMap((batch) => batch.results);
    const successCount = results.filter((result) => result.status === "success").length;
    const failCount = results.filter((result) => result.status === "failed").length;
    const pending = results.some((result) => result.status === "pending");
    return {
        ...log,
        durationMs: log.batches.reduce((total, batch) => total + batch.durationMs, 0),
        successCount,
        failCount,
        imageCount: results.length,
        status: pending ? "pending" : successCount ? "success" : "failed",
    };
}

function updateBatchResult(log: GenerationLog, batchId: string, resultId: string, next: Partial<GenerationResult>) {
    return {
        ...log,
        batches: log.batches.map((batch) =>
            batch.id === batchId
                ? summarizeBatch({ ...batch, results: batch.results.map((result) => (result.id === resultId ? { ...result, ...next } : result)) })
                : batch,
        ),
    };
}

function flattenLogResults(log: GenerationLog) {
    return log.batches.flatMap((batch) => batch.results.map((result) => ({ batch, result })));
}
