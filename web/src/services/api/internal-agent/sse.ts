export type SseJsonEvent = { event?: string; data: Record<string, unknown> };

export async function* readSseJson(response: Response): AsyncGenerator<SseJsonEvent> {
    if (!response.body) throw new Error("模型接口没有返回可读取的响应流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            for (;;) {
                const boundary = buffer.match(/\r?\n\r?\n/);
                if (!boundary) break;
                const index = boundary.index || 0;
                const block = buffer.slice(0, index);
                buffer = buffer.slice(index + boundary[0].length);
                const parsed = parseSseBlock(block);
                if (parsed) yield parsed;
            }
            if (done) break;
        }
        const parsed = parseSseBlock(buffer);
        if (parsed) yield parsed;
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

function parseSseBlock(block: string): SseJsonEvent | null {
    let event: string | undefined;
    const data: string[] = [];
    block.split(/\r?\n/).forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    });
    const text = data.join("\n").trim();
    if (!text || text === "[DONE]") return null;
    try {
        const value = JSON.parse(text) as unknown;
        return value && typeof value === "object" && !Array.isArray(value) ? { event, data: value as Record<string, unknown> } : null;
    } catch {
        throw new Error("模型接口返回了无法解析的 SSE 数据");
    }
}

export async function modelFetch(url: string, apiKey: string, body: Record<string, unknown>, signal?: AbortSignal) {
    const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) throw new Error(await modelResponseError(response));
    return response;
}

export function apiErrorMessage(value: unknown, fallback = "模型请求失败") {
    const record = asRecord(value);
    const error = asRecord(record.error);
    const response = asRecord(record.response);
    const responseError = asRecord(response.error);
    return stringValue(error.message) || stringValue(responseError.message) || stringValue(record.message) || stringValue(record.msg) || fallback;
}

async function modelResponseError(response: Response) {
    const fallback = response.status === 401 || response.status === 403
        ? "模型鉴权失败，请检查 API Key 和模型权限"
        : response.status === 429
            ? "模型请求被限流或额度不足"
            : `模型请求失败（HTTP ${response.status}）`;
    const text = await response.text().catch(() => "");
    if (!text) return fallback;
    try {
        return apiErrorMessage(JSON.parse(text), fallback);
    } catch {
        return text.slice(0, 300) || fallback;
    }
}

export function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
