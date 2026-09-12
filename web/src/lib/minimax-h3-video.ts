import { inferVideoRatio } from "@/lib/media-size";

export const MINIMAX_H3_TEXT_MODEL = "minimax-h3-文生视频";
export const MINIMAX_H3_IMAGE_MODEL = "minimax-h3-图生视频";
export const MINIMAX_H3_MULTI_MODEL = "minimax-h3-多图多音频";

export const MINIMAX_H3_MODELS = [MINIMAX_H3_TEXT_MODEL, MINIMAX_H3_IMAGE_MODEL, MINIMAX_H3_MULTI_MODEL] as const;

export type MinimaxH3Kind = "text" | "image" | "multi";

export function minimaxH3Kind(model: string): MinimaxH3Kind | null {
    const name = model.includes("::") ? model.slice(model.indexOf("::") + 2) : model;
    switch (name) {
        case MINIMAX_H3_TEXT_MODEL:
            return "text";
        case MINIMAX_H3_IMAGE_MODEL:
            return "image";
        case MINIMAX_H3_MULTI_MODEL:
            return "multi";
        default:
            return null;
    }
}

export function isMinimaxH3Model(model: string) {
    return minimaxH3Kind(model) !== null;
}

export function minimaxH3Resolution(value: string) {
    return /768/i.test(value) ? "768P" : "480P";
}

export function minimaxH3AspectRatio(size: string): "horizontal" | "vertical" {
    const ratio = inferVideoRatio(size);
    if (ratio === "auto") return "vertical";
    const match = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    return match && Number(match[1]) > Number(match[2]) ? "horizontal" : "vertical";
}

export function clampMinimaxH3Seconds(value: string) {
    const parsed = Number.parseInt(value, 10);
    return String(Math.min(15, Math.max(1, Number.isFinite(parsed) ? parsed : 5)));
}

export function buildMinimaxH3RequestBody(input: { model: string; prompt: string; seconds: string; resolution: string; size: string; imageUrls?: string[]; audioUrls?: string[] }) {
    const kind = minimaxH3Kind(input.model);
    const body: Record<string, unknown> = {
        model: input.model.includes("::") ? input.model.slice(input.model.indexOf("::") + 2) : input.model,
        prompt: input.prompt.trim(),
        duration: Number(clampMinimaxH3Seconds(input.seconds)),
        resolution: minimaxH3Resolution(input.resolution),
        aspect_ratio: minimaxH3AspectRatio(input.size),
    };
    if (kind === "image" || kind === "multi") body.reference_images = (input.imageUrls || []).map((url) => ({ url, role: "reference_image" }));
    if (kind === "multi") body.reference_audios = (input.audioUrls || []).map((url) => ({ url }));
    return body;
}
