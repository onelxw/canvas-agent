import type { ReactNode } from "react";
import { Select, Slider } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampMinimaxH3Seconds, isMinimaxH3Model } from "@/lib/minimax-h3-video";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

const standardResolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
const h3ResolutionOptions = [
    { value: "480", label: "480P" },
    { value: "768", label: "768P" },
];
const h3RatioOptions = videoRatioOptions.filter((item) => item.value === "16:9" || item.value === "9:16");

export const videoResolutionOptions = standardResolutionOptions.map((item) => ({ ...item }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({
    value: item.value,
    get label() {
        return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value;
    },
}));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    variant?: "detailed" | "workbench";
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const h3 = isMinimaxH3Model(modelOptionName(config.videoModel)) || isMinimaxH3Model(modelOptionName(config.model));
    const resolutionOptions = h3 ? h3ResolutionOptions : standardResolutionOptions;
    const ratioItems = h3 ? h3RatioOptions : videoRatioOptions;
    const resolution = normalizeResolutionForOptions(config.vquality, resolutionOptions);
    const rawRatio = inferVideoRatio(config.size || "auto");
    const selectedRatio = ratioItems.some((item) => item.value === rawRatio) ? rawRatio : h3 ? "9:16" : "auto";
    const secondsMin = h3 ? 1 : VIDEO_SECONDS_MIN;
    const secondsMax = h3 ? 15 : VIDEO_SECONDS_MAX;
    const normalizeSeconds = h3 ? clampMinimaxH3Seconds : clampVideoSeconds;
    const seconds = Number(normalizeSeconds(config.videoSeconds || (h3 ? "5" : "6")));
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", ratio === "auto" ? "auto" : computeVideoSize(nextResolution, ratio));
    };
    const ratioOptions = ratioItems.map((item) => ({
        value: item.value,
        label: (
            <SelectOptionLabel
                primary={item.value === "auto" ? t("settingsPanels.video.adaptive") : item.value}
                secondary={item.value === "auto" ? t("settingsPanels.video.adaptiveResolution") : computeVideoSize(resolution, item.value).replace("x", " × ")}
            />
        ),
    }));

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                    <SelectSetting title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                        <Select className="w-full" size="large" value={resolution} options={resolutionOptions} onChange={(value) => applySize(value, selectedRatio)} />
                    </SelectSetting>
                    <SelectSetting title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                        <Select
                            className="w-full"
                            size="large"
                            value={selectedRatio}
                            options={ratioOptions}
                            popupMatchSelectWidth={220}
                            labelRender={({ value }) => (value === "auto" ? t("settingsPanels.video.adaptive") : String(value))}
                            onChange={(value) => applySize(resolution, value)}
                        />
                    </SelectSetting>
                </div>
                <SelectSetting title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="min-w-0 flex-1" min={secondsMin} max={secondsMax} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        <SecondsInput value={seconds} min={secondsMin} max={secondsMax} normalize={normalizeSeconds} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                        <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>
                            s
                        </span>
                    </div>
                </SelectSetting>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${parseVideoResolution(value)}p`;
}
export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}
export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "5"}s`;
}
export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}
export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function normalizeResolutionForOptions(value: string, options: Array<{ value: string }>) {
    const parsed = parseVideoResolution(value);
    return options.some((item) => item.value === parsed) ? parsed : options[0].value;
}
function SelectSetting({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <label className="block min-w-0 space-y-1.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </label>
    );
}
function SelectOptionLabel({ primary, secondary }: { primary: string; secondary: string }) {
    return (
        <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0">{primary}</span>
            <span className="shrink-0 text-[11px] opacity-55">{secondary}</span>
        </span>
    );
}
function SecondsInput({ value, min, max, normalize, theme, onCommit }: { value: number; min: number; max: number; normalize: (value: string) => string; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(normalize(input.value));
        input.value = String(next);
        onCommit(next);
    };
    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={min}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}
