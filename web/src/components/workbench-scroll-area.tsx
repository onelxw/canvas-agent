import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type ThumbMetrics = {
    height: number;
    top: number;
    visible: boolean;
};

type DragState = {
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
};

type WorkbenchScrollAreaProps = {
    children: ReactNode;
    className?: string;
    viewportClassName?: string;
};

const TRACK_INSET = 8;
const MIN_THUMB_HEIGHT = 28;

export function WorkbenchScrollArea({ children, className, viewportClassName }: WorkbenchScrollAreaProps) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const [thumb, setThumb] = useState<ThumbMetrics>({ height: 0, top: TRACK_INSET, visible: false });

    const syncThumb = useCallback(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
        const trackHeight = Math.max(0, viewport.clientHeight - TRACK_INSET * 2);
        if (maxScroll <= 1 || trackHeight <= 0) {
            setThumb((current) => (current.visible ? { height: 0, top: TRACK_INSET, visible: false } : current));
            return;
        }
        const height = Math.min(trackHeight, Math.max(MIN_THUMB_HEIGHT, (viewport.clientHeight / viewport.scrollHeight) * trackHeight));
        const travel = Math.max(0, trackHeight - height);
        const top = TRACK_INSET + (viewport.scrollTop / maxScroll) * travel;
        setThumb((current) => (current.visible && Math.abs(current.height - height) < 0.5 && Math.abs(current.top - top) < 0.5 ? current : { height, top, visible: true }));
    }, []);

    useLayoutEffect(() => {
        syncThumb();
    });

    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncThumb);
        const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(syncThumb);
        resizeObserver?.observe(viewport);
        mutationObserver?.observe(viewport, { childList: true, subtree: true });
        window.addEventListener("resize", syncThumb);
        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            window.removeEventListener("resize", syncThumb);
        };
    }, [syncThumb]);

    const scrollFromTrackPosition = (track: HTMLDivElement, clientY: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
        const travel = track.clientHeight - thumb.height;
        if (maxScroll <= 0 || travel <= 0) return;
        const top = Math.min(travel, Math.max(0, clientY - track.getBoundingClientRect().top - thumb.height / 2));
        viewport.scrollTop = (top / travel) * maxScroll;
        syncThumb();
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if ((event.target as HTMLElement).dataset.workbenchScrollbarThumb !== undefined) {
            dragRef.current = { pointerId: event.pointerId, startClientY: event.clientY, startScrollTop: viewport.scrollTop };
            return;
        }
        scrollFromTrackPosition(event.currentTarget, event.clientY);
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        const drag = dragRef.current;
        if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
        const maxScroll = viewport.scrollHeight - viewport.clientHeight;
        const travel = event.currentTarget.clientHeight - thumb.height;
        if (maxScroll <= 0 || travel <= 0) return;
        viewport.scrollTop = drag.startScrollTop + ((event.clientY - drag.startClientY) / travel) * maxScroll;
        syncThumb();
    };

    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };

    return (
        <div className={cn("relative overflow-hidden", className)}>
            <div ref={viewportRef} className={cn("workbench-scrollbar min-h-0", viewportClassName)} onScroll={syncThumb}>
                {children}
            </div>
            {thumb.visible ? (
                <div
                    className="absolute bottom-2 right-0 top-2 z-20 w-3 cursor-pointer touch-none rounded-full hover:bg-stone-200/45 dark:hover:bg-stone-800/55"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    aria-hidden="true"
                    data-workbench-scrollbar-track
                >
                    <span
                        className="absolute right-1 block w-[3px] rounded-full bg-stone-400/75 transition-colors hover:bg-stone-500 dark:bg-stone-500/80 dark:hover:bg-stone-400"
                        style={{ height: thumb.height, transform: `translateY(${thumb.top - TRACK_INSET}px)` }}
                        data-workbench-scrollbar-thumb
                    />
                </div>
            ) : null}
        </div>
    );
}
