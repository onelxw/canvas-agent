import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { useInternalAgentStore } from "@/stores/use-internal-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { InternalAgentCanvasContext, InternalAgentRevisionedSnapshot } from "@/lib/internal-agent/tools/executor";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const setInternalAgentCanvasContext = useInternalAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const revisionRef = useRef(0);
    const observedRef = useRef({ projectId, nodes, connections, selectedNodeIds, viewport });
    const projectTitle = title || i18n.t("canvas.project.untitled");

    useLayoutEffect(() => {
        const observed = observedRef.current;
        if (observed.projectId !== projectId) revisionRef.current = 0;
        else if (observed.nodes !== nodes || observed.connections !== connections) revisionRef.current += 1;
        observedRef.current = { projectId, nodes, connections, selectedNodeIds, viewport };
    }, [connections, nodes, projectId, selectedNodeIds, viewport]);

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle };
        },
        [projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    const internalAgentCanvasContext = useMemo<InternalAgentCanvasContext>(() => {
        const getSnapshot = (): InternalAgentRevisionedSnapshot => ({
            projectId,
            revision: revisionRef.current,
            title: projectTitle,
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            selectedNodeIds: Array.from(selectedNodeIdsRef.current),
            viewport: viewportRef.current,
        });
        return {
            getSnapshot,
            applyOps: (ops) => {
                const before = getSnapshot();
                const next = applyCanvasAgentOps(before, ops.filter((op) => op.type !== "run_generation"));
                const nextSelection = new Set(next.selectedNodeIds);
                nodesRef.current = next.nodes;
                connectionsRef.current = next.connections;
                selectedNodeIdsRef.current = nextSelection;
                viewportRef.current = next.viewport;
                if (ops.some((op) => op.type !== "select_nodes" && op.type !== "set_viewport" && op.type !== "run_generation")) revisionRef.current += 1;
                observedRef.current = { projectId, nodes: next.nodes, connections: next.connections, selectedNodeIds: nextSelection, viewport: next.viewport };
                setNodes(next.nodes);
                setConnections(next.connections);
                setSelectedNodeIds(nextSelection);
                setSelectedConnectionId(null);
                setViewport(next.viewport);
                setContextMenu(null);
                return { ...next, revision: revisionRef.current };
            },
            runGeneration: async ({ nodeId, mode, prompt }) => {
                const target = nodesRef.current.find((node) => node.id === nodeId);
                if (!target) throw new Error(`节点不存在：${nodeId}`);
                const effectivePrompt = prompt?.trim() ? prompt : (target.metadata?.composerContent ?? target.metadata?.prompt ?? "");
                queueMicrotask(() => void generateNodeRef.current?.(nodeId, mode || target.metadata?.generationMode || "image", effectivePrompt));
            },
        };
    }, [projectId, projectTitle]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);

    useEffect(() => {
        setInternalAgentCanvasContext(internalAgentCanvasContext);
        return () => setInternalAgentCanvasContext(null);
    }, [internalAgentCanvasContext, setInternalAgentCanvasContext]);

    return { applyAgentOps };
}
