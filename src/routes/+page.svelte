<script lang="ts">
	import {
		NODE_HEIGHT,
		NODE_WIDTH,
		createSavedDiagram,
		getCurrentGraph,
		layoutGraph,
		parseGraph,
		type DiagramEdge,
		type SavedDiagram
	} from '$lib/diagram';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import CornersOutIcon from 'phosphor-svelte/lib/CornersOutIcon';
	import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
	import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import ListIcon from 'phosphor-svelte/lib/ListIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import { onMount, tick } from 'svelte';

	const STORAGE_KEY = 'diagrams:v1';
	const ACTIVE_KEY = 'diagrams:active';
	const NODE_TEXT_PRESETS = [
		{ maxCharacters: 31, maxLines: 2, fontSize: 16, lineHeight: 22, letterSpacing: -0.15 },
		{ maxCharacters: 34, maxLines: 3, fontSize: 15, lineHeight: 20.5, letterSpacing: -0.05 },
		{ maxCharacters: 37, maxLines: 4, fontSize: 14, lineHeight: 18.5, letterSpacing: 0 }
	] as const;

	let diagrams = $state<SavedDiagram[]>([]);
	let activeId = $state('');
	let prompt = $state('');
	let loaded = $state(false);
	let submitting = $state(false);
	let errorMessage = $state('');
	let sidebarOpen = $state(false);
	let svgElement = $state<SVGSVGElement>();
	let promptElement = $state<HTMLTextAreaElement>();
	let actionMenu = $state<HTMLDetailsElement>();
	let deleteDialog = $state<HTMLDialogElement>();
	let pendingDeleteId = $state('');
	let embeddedInstrumentFont: string | undefined;
	let view = $state({ x: 0, y: 0, width: 1200, height: 720 });
	let pan = $state<{
		pointerId: number;
		clientX: number;
		clientY: number;
		viewX: number;
		viewY: number;
	} | null>(null);

	let activeDiagram = $derived(diagrams.find((diagram) => diagram.id === activeId));
	let diagramPendingDeletion = $derived(diagrams.find((diagram) => diagram.id === pendingDeleteId));
	let graph = $derived(getCurrentGraph(activeDiagram));
	let layout = $derived(layoutGraph(graph));
	let convergenceTargets = $derived(
		layout.nodes.filter((node) => layout.edges.filter((edge) => edge.to === node.id).length > 1)
	);
	let canUndo = $derived(Boolean(activeDiagram && activeDiagram.versionIndex > 0));
	let canRedo = $derived(
		Boolean(activeDiagram && activeDiagram.versionIndex < activeDiagram.versions.length - 1)
	);

	onMount(() => {
		diagrams = restoreDiagrams();
		if (diagrams.length === 0) diagrams = [createSavedDiagram()];
		const savedId = localStorage.getItem(ACTIVE_KEY);
		activeId = diagrams.some((diagram) => diagram.id === savedId)
			? (savedId ?? diagrams[0].id)
			: diagrams[0].id;
		loaded = true;
		void tick().then(focusResultView);

		const onResize = () => focusResultView();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	$effect(() => {
		if (!loaded) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(diagrams));
		localStorage.setItem(ACTIVE_KEY, activeId);
	});

	async function submitPrompt(): Promise<void> {
		const value = prompt.trim();
		if (!value || submitting || !activeDiagram) return;

		submitting = true;
		errorMessage = '';
		prompt = '';
		await tick();
		if (promptElement) promptElement.style.height = 'auto';

		try {
			const response = await fetch('/api/diagram', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt: value,
					graph: graph ?? null,
					history: activeDiagram.prompts.slice(0, activeDiagram.versionIndex + 1)
				})
			});
			const result = (await response.json()) as { graph?: unknown; error?: string };
			if (!response.ok || !result.graph) throw new Error(result.error || 'Generation failed.');

			const nextGraph = parseGraph(result.graph);
			activeDiagram.versions = activeDiagram.versions.slice(0, activeDiagram.versionIndex + 1);
			activeDiagram.prompts = activeDiagram.prompts.slice(0, activeDiagram.versionIndex + 1);
			activeDiagram.versions.push(nextGraph);
			activeDiagram.prompts.push(value);
			activeDiagram.versionIndex = activeDiagram.versions.length - 1;
			activeDiagram.name = nextGraph.title;
			activeDiagram.updatedAt = new Date().toISOString();
			await tick();
			focusResultView();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Generation failed.';
			prompt = value;
		} finally {
			submitting = false;
			await tick();
			promptElement?.focus();
		}
	}

	function restoreDiagrams(): SavedDiagram[] {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		try {
			const stored = JSON.parse(raw) as unknown;
			if (!Array.isArray(stored)) return [];
			return stored.flatMap((item): SavedDiagram[] => {
				if (!isRecord(item) || !Array.isArray(item.versions)) return [];
				try {
					const versions = item.versions.map(parseGraph);
					const maximumIndex = versions.length - 1;
					const versionIndex = Math.min(
						Math.max(Number(item.versionIndex) || 0, maximumIndex >= 0 ? 0 : -1),
						maximumIndex
					);
					return [
						{
							id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
							name: typeof item.name === 'string' ? item.name : 'Untitled',
							versions,
							versionIndex,
							prompts: Array.isArray(item.prompts)
								? item.prompts.filter((value): value is string => typeof value === 'string')
								: [],
							updatedAt:
								typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString()
						}
					];
				} catch {
					return [];
				}
			});
		} catch {
			return [];
		}
	}

	function createDiagram(): void {
		const diagram = createSavedDiagram();
		diagrams.unshift(diagram);
		activeId = diagram.id;
		sidebarOpen = false;
		errorMessage = '';
		view = { x: 0, y: 0, width: 1200, height: 720 };
		void tick().then(() => {
			if (promptElement) promptElement.style.height = 'auto';
			promptElement?.focus();
		});
	}

	function requestDiagramDeletion(id = activeId, event?: MouseEvent): void {
		pendingDeleteId = id;
		actionMenu?.removeAttribute('open');
		(event?.currentTarget as HTMLElement | undefined)?.closest('details')?.removeAttribute('open');
		deleteDialog?.showModal();
	}

	function deleteActiveDiagram(): void {
		if (!diagramPendingDeletion) return;
		const deletedId = diagramPendingDeletion.id;
		const deletedIndex = diagrams.findIndex((diagram) => diagram.id === deletedId);
		const deletedActiveDiagram = deletedId === activeId;
		diagrams = diagrams.filter((diagram) => diagram.id !== deletedId);
		if (diagrams.length === 0) diagrams = [createSavedDiagram()];
		if (deletedActiveDiagram) {
			activeId = diagrams[Math.min(Math.max(deletedIndex, 0), diagrams.length - 1)].id;
			prompt = '';
			errorMessage = '';
			view = { x: 0, y: 0, width: 1200, height: 720 };
		}
		pendingDeleteId = '';
		deleteDialog?.close();
		if (deletedActiveDiagram) {
			void tick().then(() => {
				if (promptElement) promptElement.style.height = 'auto';
				focusResultView();
			});
		}
	}

	function openDiagram(id: string): void {
		activeId = id;
		sidebarOpen = false;
		errorMessage = '';
		void tick().then(focusResultView);
	}

	function undo(): void {
		if (!activeDiagram || !canUndo) return;
		activeDiagram.versionIndex -= 1;
		void tick().then(focusResultView);
	}

	function redo(): void {
		if (!activeDiagram || !canRedo) return;
		activeDiagram.versionIndex += 1;
		void tick().then(focusResultView);
	}

	function handlePromptKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submitPrompt();
		}
	}

	function resizePrompt(event: Event): void {
		const textarea = event.currentTarget as HTMLTextAreaElement;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		const command = event.metaKey || event.ctrlKey;
		if (command && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		}
		if (command && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			promptElement?.focus();
		}
		if (event.key === 'Escape') sidebarOpen = false;
	}

	function fitView(): void {
		if (!svgElement) return;
		const rect = svgElement.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const padding = 64;
		let width = layout.width + padding * 2;
		let height = layout.height + padding * 2;
		const screenRatio = rect.width / rect.height;
		if (width / height > screenRatio) height = width / screenRatio;
		else width = height * screenRatio;
		view = {
			x: (layout.width - width) / 2,
			y: (layout.height - height) / 2,
			width,
			height
		};
	}

	function focusResultView(): void {
		if (!svgElement || !graph || layout.nodes.length === 0) {
			fitView();
			return;
		}

		const revisionTargets =
			(activeDiagram?.versionIndex ?? 0) > 0
				? layout.nodes.filter((node) => graph?.focusNodeIds.includes(node.id))
				: [];
		const targets =
			revisionTargets.length > 0 ? revisionTargets : layout.nodes.filter((node) => node.depth <= 2);
		const visible = targets.length > 0 ? targets : layout.nodes;
		const rect = svgElement.getBoundingClientRect();
		if (!rect.width || !rect.height) return;

		if (rect.width < 640) {
			const target =
				revisionTargets[0] ?? layout.nodes.find((node) => node.depth === 0) ?? visible[0];
			const width = 470;
			const height = width / (rect.width / rect.height);
			view = {
				x: target.x + NODE_WIDTH / 2 - width / 2,
				y: target.y + NODE_HEIGHT / 2 - height / 2,
				width,
				height
			};
			return;
		}

		const minimumX = Math.min(...visible.map((node) => node.x));
		const maximumX = Math.max(...visible.map((node) => node.x + NODE_WIDTH));
		const minimumY = Math.min(...visible.map((node) => node.y));
		const maximumY = Math.max(...visible.map((node) => node.y + NODE_HEIGHT));

		const padding = 70;
		let width = Math.max(720, maximumX - minimumX + padding * 2);
		let height = Math.max(520, maximumY - minimumY + padding * 2);
		const screenRatio = rect.width / rect.height;
		if (width / height > screenRatio) height = width / screenRatio;
		else width = height * screenRatio;
		view = {
			x: (minimumX + maximumX - width) / 2,
			y: (minimumY + maximumY - height) / 2,
			width,
			height
		};
	}

	function zoom(factor: number): void {
		const centerX = view.x + view.width / 2;
		const centerY = view.y + view.height / 2;
		const width = clamp(view.width * factor, 480, Math.max(2600, layout.width * 2.4));
		const height = width * (view.height / view.width);
		view = { x: centerX - width / 2, y: centerY - height / 2, width, height };
	}

	function handleWheel(event: WheelEvent): void {
		if (!svgElement) return;
		event.preventDefault();
		const rect = svgElement.getBoundingClientRect();

		if (!event.ctrlKey) {
			const horizontalDelta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
			const verticalDelta = event.shiftKey ? 0 : event.deltaY;
			view = {
				...view,
				x: view.x + (horizontalDelta / rect.width) * view.width,
				y: view.y + (verticalDelta / rect.height) * view.height
			};
			return;
		}

		const pointX = view.x + ((event.clientX - rect.left) / rect.width) * view.width;
		const pointY = view.y + ((event.clientY - rect.top) / rect.height) * view.height;
		const factor = Math.exp(event.deltaY * 0.0012);
		const width = clamp(view.width * factor, 480, Math.max(2600, layout.width * 2.4));
		const height = width * (view.height / view.width);
		const ratioX = (pointX - view.x) / view.width;
		const ratioY = (pointY - view.y) / view.height;
		view = {
			x: pointX - ratioX * width,
			y: pointY - ratioY * height,
			width,
			height
		};
	}

	function startPan(event: PointerEvent): void {
		if (!svgElement || event.button !== 0) return;
		pan = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			viewX: view.x,
			viewY: view.y
		};
		svgElement.setPointerCapture(event.pointerId);
	}

	function movePan(event: PointerEvent): void {
		if (!pan || !svgElement || pan.pointerId !== event.pointerId) return;
		const rect = svgElement.getBoundingClientRect();
		view = {
			...view,
			x: pan.viewX - ((event.clientX - pan.clientX) / rect.width) * view.width,
			y: pan.viewY - ((event.clientY - pan.clientY) / rect.height) * view.height
		};
	}

	function endPan(event: PointerEvent): void {
		if (pan?.pointerId === event.pointerId) pan = null;
	}

	function edgePath(edge: DiagramEdge): string {
		const from = layout.nodes.find((node) => node.id === edge.from);
		const to = layout.nodes.find((node) => node.id === edge.to);
		if (!from || !to) return '';
		const startX = from.x + NODE_WIDTH;
		const startY = from.y + NODE_HEIGHT / 2;
		const endX = to.x;
		const endY = to.y + NODE_HEIGHT / 2;
		const bend = Math.max(72, (endX - startX) * 0.48);
		return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
	}

	function incomingEdgeCount(nodeId: string): number {
		return layout.edges.filter((edge) => edge.to === nodeId).length;
	}

	function mergePoint(nodeId: string): { x: number; y: number } {
		const node = layout.nodes.find((candidate) => candidate.id === nodeId);
		return node ? { x: node.x - 74, y: node.y + NODE_HEIGHT / 2 } : { x: 0, y: 0 };
	}

	function convergenceBranchPath(edge: DiagramEdge): string {
		const from = layout.nodes.find((node) => node.id === edge.from);
		const to = layout.nodes.find((node) => node.id === edge.to);
		if (!from || !to) return '';

		const startX = from.x + NODE_WIDTH;
		const startY = from.y + NODE_HEIGHT / 2;
		const merge = mergePoint(edge.to);
		const span = merge.x - startX;

		if (span > 470) {
			const topRail = Math.min(...layout.nodes.map((node) => node.y)) - 30;
			const bottomRail = Math.max(...layout.nodes.map((node) => node.y + NODE_HEIGHT)) + 30;
			const railY = startY <= merge.y ? topRail : bottomRail;
			return `M ${startX} ${startY} C ${startX + 42} ${startY}, ${startX + 52} ${railY}, ${startX + 92} ${railY} L ${merge.x - 52} ${railY} C ${merge.x - 20} ${railY}, ${merge.x - 28} ${merge.y}, ${merge.x} ${merge.y}`;
		}

		const bend = Math.max(24, Math.min(80, span * 0.45));
		return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${merge.x - bend} ${merge.y}, ${merge.x} ${merge.y}`;
	}

	function convergenceTrunkPath(nodeId: string): string {
		const node = layout.nodes.find((candidate) => candidate.id === nodeId);
		if (!node) return '';
		const merge = mergePoint(nodeId);
		const endY = node.y + NODE_HEIGHT / 2;
		return `M ${merge.x} ${merge.y} C ${merge.x + 30} ${merge.y}, ${node.x - 28} ${endY}, ${node.x} ${endY}`;
	}

	function nodeTextLayout(value: string): {
		lines: string[];
		fontSize: number;
		lineHeight: number;
		letterSpacing: number;
		startY: number;
	} {
		for (const preset of NODE_TEXT_PRESETS) {
			const lines = wrapWords(value, preset.maxCharacters);
			if (lines.length <= preset.maxLines) {
				return {
					lines,
					fontSize: preset.fontSize,
					lineHeight: preset.lineHeight,
					letterSpacing: preset.letterSpacing,
					startY: NODE_HEIGHT / 2 - ((lines.length - 1) * preset.lineHeight) / 2
				};
			}
		}

		const fallback = NODE_TEXT_PRESETS[NODE_TEXT_PRESETS.length - 1];
		const lines = wrapWords(value, fallback.maxCharacters).slice(0, fallback.maxLines);
		lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, fallback.maxCharacters - 1)}…`;
		return {
			lines,
			fontSize: fallback.fontSize,
			lineHeight: fallback.lineHeight,
			letterSpacing: fallback.letterSpacing,
			startY: NODE_HEIGHT / 2 - ((lines.length - 1) * fallback.lineHeight) / 2
		};
	}

	function wrapWords(value: string, width: number): string[] {
		const words = value.split(/\s+/);
		const lines: string[] = [];
		let line = '';
		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (!line || candidate.length <= width) line = candidate;
			else {
				lines.push(line);
				line = word;
			}
		}
		if (line) lines.push(line);
		return lines;
	}

	function exportJson(): void {
		if (!activeDiagram || !graph) return;
		download(
			`${filename(activeDiagram.name)}.json`,
			new Blob(
				[
					JSON.stringify(
						{
							graph,
							prompts: activeDiagram.prompts.slice(0, activeDiagram.versionIndex + 1)
						},
						null,
						2
					)
				],
				{ type: 'application/json' }
			)
		);
	}

	async function exportPng(): Promise<void> {
		if (!svgElement || !activeDiagram || !graph) return;
		try {
			const clone = svgElement.cloneNode(true) as SVGSVGElement;
			const defs = clone.querySelector('defs');
			if (defs) {
				const embeddedFontStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
				embeddedFontStyle.textContent = await instrumentFontFaceForExport();
				defs.appendChild(embeddedFontStyle);
			}
			clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
			clone.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
			clone.setAttribute('width', String(layout.width));
			clone.setAttribute('height', String(layout.height));
			const source = new Blob([new XMLSerializer().serializeToString(clone)], {
				type: 'image/svg+xml;charset=utf-8'
			});
			const sourceUrl = URL.createObjectURL(source);
			const image = new Image();
			image.src = sourceUrl;
			await image.decode();
			const scale = Math.min(2, 5600 / Math.max(layout.width, layout.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(layout.width * scale);
			canvas.height = Math.round(layout.height * scale);
			const context = canvas.getContext('2d');
			if (!context) throw new Error('PNG export is unavailable in this browser.');
			context.scale(scale, scale);
			context.drawImage(image, 0, 0);
			URL.revokeObjectURL(sourceUrl);
			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(value) => (value ? resolve(value) : reject(new Error('PNG export failed.'))),
					'image/png'
				);
			});
			download(`${filename(activeDiagram.name)}.png`, blob);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'PNG export failed.';
		}
	}

	async function instrumentFontFaceForExport(): Promise<string> {
		if (!embeddedInstrumentFont) {
			const response = await fetch('/fonts/InstrumentSans-Variable.woff2');
			if (!response.ok) throw new Error('Instrument Sans could not be loaded for export.');
			embeddedInstrumentFont = arrayBufferToBase64(await response.arrayBuffer());
		}
		return `@font-face { font-family: 'Instrument Sans'; src: url(data:font/woff2;base64,${embeddedInstrumentFont}) format('woff2'); font-weight: 400 700; font-stretch: 75% 100%; font-style: normal; }`;
	}

	function arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		const chunkSize = 0x8000;
		for (let offset = 0; offset < bytes.length; offset += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
		}
		return btoa(binary);
	}

	function download(name: string, blob: Blob): void {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function filename(value: string): string {
		return (
			value
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || 'diagram'
		);
	}

	function shortTitle(value: string): string {
		return value.length > 28 ? `${value.slice(0, 27)}…` : value;
	}

	function clamp(value: number, minimum: number, maximum: number): number {
		return Math.min(Math.max(value, minimum), maximum);
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}
</script>

<svelte:head>
	<title>{graph?.title ?? 'Diagrams'}</title>
	<meta name="description" content="Generate and revise diagrams of possible future states." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<main class:is-panning={Boolean(pan)}>
	<aside class="history-sidebar" class:open={sidebarOpen}>
		<div class="sidebar-heading">
			<strong>Diagrams</strong>
			<button type="button" onclick={createDiagram} aria-label="New diagram" title="New diagram">
				<PlusIcon size={19} weight="regular" />
			</button>
		</div>
		<nav aria-label="Diagram history">
			<span class="history-label">History</span>
			{#each diagrams as diagram (diagram.id)}
				<div class="history-row" class:active={diagram.id === activeId}>
					<button
						type="button"
						class="history-item"
						onclick={() => openDiagram(diagram.id)}
						title={diagram.name}
					>
						<span>{shortTitle(diagram.name)}</span>
					</button>
					<details class="history-item-menu">
						<summary aria-label={`Actions for ${diagram.name}`} title="Diagram actions">
							<DotsThreeIcon size={19} weight="bold" />
						</summary>
						<div>
							<button type="button" onclick={(event) => requestDiagramDeletion(diagram.id, event)}>
								<TrashIcon size={16} weight="regular" />
								<span>Delete</span>
							</button>
						</div>
					</details>
				</div>
			{/each}
		</nav>
	</aside>

	{#if sidebarOpen}
		<button
			type="button"
			class="sidebar-scrim"
			onclick={() => (sidebarOpen = false)}
			aria-label="Close history"
		></button>
	{/if}

	<section class="workspace" class:has-result={Boolean(graph)}>
		<button
			type="button"
			class="sidebar-toggle"
			onclick={() => (sidebarOpen = true)}
			aria-label="Open history"
		>
			<ListIcon size={20} weight="regular" />
		</button>

		{#if graph}
			<header class="result-header">
				<div class="result-title">
					<h1>{graph.title}</h1>
					<p>{graph.summary}</p>
				</div>

				<div class="result-actions">
					<button type="button" onclick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
						<ArrowCounterClockwiseIcon size={18} weight="regular" />
					</button>
					<button type="button" onclick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
						<ArrowClockwiseIcon size={18} weight="regular" />
					</button>
					<details class="more-menu" bind:this={actionMenu}>
						<summary aria-label="Diagram actions">
							<DotsThreeIcon size={20} weight="bold" />
						</summary>
						<div>
							<button type="button" onclick={() => void exportPng()}>
								<ImageIcon size={16} weight="regular" />
								<span>Export PNG</span>
							</button>
							<button type="button" onclick={exportJson}>
								<FileCodeIcon size={16} weight="regular" />
								<span>Export JSON</span>
							</button>
							<button type="button" class="danger-action" onclick={() => requestDiagramDeletion()}>
								<TrashIcon size={16} weight="regular" />
								<span>Delete diagram</span>
							</button>
						</div>
					</details>
				</div>
			</header>
		{/if}

		<section class="canvas-region" aria-label="Possibility diagram">
			<svg
				bind:this={svgElement}
				class="diagram-canvas"
				viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
				preserveAspectRatio="xMidYMid meet"
				onwheel={handleWheel}
				onpointerdown={startPan}
				onpointermove={movePan}
				onpointerup={endPan}
				onpointercancel={endPan}
				role="img"
				aria-label={graph?.title ?? 'No diagram generated'}
			>
				<defs>
					<style>
						.svg-text {
							font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
						}
					</style>
					<pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
						<circle cx="1" cy="1" r="0.8" fill="#292927" />
					</pattern>
					<filter id="node-shadow" x="-20%" y="-30%" width="140%" height="170%">
						<feDropShadow
							dx="0"
							dy="8"
							stdDeviation="9"
							flood-color="#000000"
							flood-opacity="0.22"
						/>
					</filter>
					<marker
						id="arrow-neutral"
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#7d7d77" />
					</marker>
					<marker
						id="arrow-positive"
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#70a47a" />
					</marker>
					<marker
						id="arrow-negative"
						viewBox="0 0 10 10"
						refX="8"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" fill="#c47769" />
					</marker>
				</defs>
				<rect width={layout.width} height={layout.height} fill="#000000" />
				{#if graph}
					<rect width={layout.width} height={layout.height} fill="url(#grid)" />
				{/if}

				{#if graph}
					<g class="svg-text">
						{#each layout.edges as edge (edge.id)}
							{@const target = layout.nodes.find((node) => node.id === edge.to)}
							{@const source = layout.nodes.find((node) => node.id === edge.from)}
							{@const converges = incomingEdgeCount(edge.to) > 1}
							{@const colorNode = converges ? source : target}
							{@const edgeColor =
								colorNode?.outlook === 'positive'
									? '#70a47a'
									: colorNode?.outlook === 'negative'
										? '#c47769'
										: '#7d7d77'}
							{@const marker =
								target?.outlook === 'positive'
									? 'url(#arrow-positive)'
									: target?.outlook === 'negative'
										? 'url(#arrow-negative)'
										: 'url(#arrow-neutral)'}
							<g>
								<path
									d={converges ? convergenceBranchPath(edge) : edgePath(edge)}
									fill="none"
									stroke="#000000"
									stroke-width="7"
								/>
								<path
									d={converges ? convergenceBranchPath(edge) : edgePath(edge)}
									fill="none"
									stroke={edgeColor}
									stroke-width="1.6"
									marker-end={converges ? undefined : marker}
								/>
							</g>
						{/each}

						{#each convergenceTargets as target (target.id)}
							{@const point = mergePoint(target.id)}
							{@const trunkColor =
								target.outlook === 'positive'
									? '#70a47a'
									: target.outlook === 'negative'
										? '#c47769'
										: '#7d7d77'}
							{@const trunkMarker =
								target.outlook === 'positive'
									? 'url(#arrow-positive)'
									: target.outlook === 'negative'
										? 'url(#arrow-negative)'
										: 'url(#arrow-neutral)'}
							<g class="convergence-junction">
								<path
									d={convergenceTrunkPath(target.id)}
									fill="none"
									stroke="#000000"
									stroke-width="7"
								/>
								<path
									d={convergenceTrunkPath(target.id)}
									fill="none"
									stroke={trunkColor}
									stroke-width="1.8"
									marker-end={trunkMarker}
								/>
								<circle
									cx={point.x}
									cy={point.y}
									r="4"
									fill={trunkColor}
									stroke="#000000"
									stroke-width="2"
								/>
							</g>
						{/each}

						{#each layout.nodes as node (node.id)}
							{@const typography = nodeTextLayout(node.text)}
							<g class="graph-node" transform={`translate(${node.x} ${node.y})`}>
								<title>{node.text}</title>
								<rect
									width={NODE_WIDTH}
									height={NODE_HEIGHT}
									rx="12"
									fill="#212121"
									stroke="none"
									filter="url(#node-shadow)"
								/>
								<text
									x={NODE_WIDTH / 2}
									y={typography.startY}
									text-anchor="middle"
									fill="#f1f1ed"
									font-size={typography.fontSize}
									font-weight="600"
									letter-spacing={`${typography.letterSpacing}px`}
								>
									{#each typography.lines as line, index (index)}
										<tspan x={NODE_WIDTH / 2} dy={index === 0 ? 0 : typography.lineHeight}
											>{line}</tspan
										>
									{/each}
								</text>
							</g>
						{/each}
					</g>
				{/if}
			</svg>

			{#if submitting && graph}
				<div class="loading-state" role="status">
					<span></span>
					Generating diagram…
				</div>
			{/if}

			{#if graph}
				<div class="zoom-controls" aria-label="Zoom controls">
					<button type="button" onclick={() => zoom(1.2)} aria-label="Zoom out" title="Zoom out">
						<MinusIcon size={16} weight="regular" />
					</button>
					<button type="button" onclick={fitView} aria-label="Fit diagram" title="Fit diagram">
						<CornersOutIcon size={16} weight="regular" />
					</button>
					<button type="button" onclick={() => zoom(0.8)} aria-label="Zoom in" title="Zoom in">
						<PlusIcon size={16} weight="regular" />
					</button>
				</div>
			{/if}
		</section>

		<section class="prompt-area" class:empty-prompt={!graph}>
			{#if !graph}
				<h1 class="composer-title">Consult the diagrams</h1>
			{/if}

			{#if errorMessage}
				<div class="error-message" role="alert">
					<p>{errorMessage}</p>
					<button type="button" onclick={() => (errorMessage = '')}>Dismiss</button>
				</div>
			{/if}

			<form
				class="prompt-form"
				onsubmit={(event) => {
					event.preventDefault();
					void submitPrompt();
				}}
			>
				<label class="sr-only" for="diagram-prompt"
					>{graph ? 'Ask what changes in this diagram' : 'Describe a situation'}</label
				>
				<div class="prompt-control">
					<textarea
						id="diagram-prompt"
						bind:this={promptElement}
						bind:value={prompt}
						onkeydown={handlePromptKeydown}
						oninput={resizePrompt}
						placeholder={graph ? 'Ask what changes…' : 'Describe a situation…'}
						rows="1"
						maxlength="4000"
						disabled={submitting}></textarea>
					<button
						type="submit"
						class="send-button"
						disabled={!prompt.trim() || submitting}
						aria-label={submitting ? 'Generating diagram' : 'Generate diagram'}
					>
						{#if submitting}
							<span class="send-spinner"></span>
						{:else}
							<ArrowUpIcon size={20} weight="bold" />
						{/if}
					</button>
				</div>
			</form>
		</section>
	</section>

	<dialog class="confirm-dialog" bind:this={deleteDialog}>
		<form method="dialog">
			<h2>Delete this diagram?</h2>
			<p>
				{diagramPendingDeletion?.name ?? 'This diagram'} and its prompt history will be removed.
			</p>
			<div>
				<button type="submit">Cancel</button>
				<button type="button" class="confirm-delete" onclick={deleteActiveDiagram}>Delete</button>
			</div>
		</form>
	</dialog>
</main>
