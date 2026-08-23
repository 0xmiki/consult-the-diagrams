export type DiagramNodeKind = 'origin' | 'state' | 'horizon';
export type DiagramOutlook = 'positive' | 'negative' | 'neutral';

export interface DiagramNode {
	id: string;
	text: string;
	kind: DiagramNodeKind;
	outlook: DiagramOutlook;
}

export interface DiagramEdge {
	id: string;
	from: string;
	to: string;
}

export interface DiagramGraph {
	title: string;
	summary: string;
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	focusNodeIds: string[];
}

export interface SavedDiagram {
	id: string;
	name: string;
	versions: DiagramGraph[];
	versionIndex: number;
	prompts: string[];
	updatedAt: string;
}

export interface PositionedNode extends DiagramNode {
	x: number;
	y: number;
	depth: number;
}

export interface DiagramLayout {
	nodes: PositionedNode[];
	edges: DiagramEdge[];
	width: number;
	height: number;
}

export const NODE_WIDTH = 288;
export const NODE_HEIGHT = 88;

export function createSavedDiagram(): SavedDiagram {
	return {
		id: crypto.randomUUID(),
		name: 'Untitled',
		versions: [],
		versionIndex: -1,
		prompts: [],
		updatedAt: new Date().toISOString()
	};
}

export function getCurrentGraph(diagram: SavedDiagram | undefined): DiagramGraph | undefined {
	if (!diagram || diagram.versionIndex < 0) return undefined;
	return diagram.versions[diagram.versionIndex];
}

export function parseGraph(input: unknown): DiagramGraph {
	if (!isObject(input)) throw new Error('The response is not a diagram.');
	if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 40) {
		throw new Error('A diagram must contain between 2 and 40 states.');
	}
	if (!Array.isArray(input.edges) || input.edges.length < 1 || input.edges.length > 80) {
		throw new Error('A diagram must contain between 1 and 80 paths.');
	}

	const nodeIds = new Set<string>();
	const nodes = input.nodes.map((value, index): DiagramNode => {
		if (!isObject(value)) throw new Error(`State ${index + 1} is invalid.`);
		const id = readId(value.id, `state ${index + 1}`);
		if (nodeIds.has(id)) throw new Error(`State id ${id} is duplicated.`);
		nodeIds.add(id);
		if (value.kind !== 'origin' && value.kind !== 'state' && value.kind !== 'horizon') {
			throw new Error(`State ${id} has an invalid type.`);
		}
		const outlook =
			value.outlook === 'positive' || value.outlook === 'negative' || value.outlook === 'neutral'
				? value.outlook
				: 'neutral';
		const legacyText =
			typeof value.detail === 'string' && value.detail.trim()
				? value.detail
				: typeof value.label === 'string'
					? value.label
					: undefined;
		return {
			id,
			text: readText(value.text ?? legacyText, `state ${id}`, 180),
			kind: value.kind,
			outlook
		};
	});

	const edgeIds = new Set<string>();
	const edges = input.edges.map((value, index): DiagramEdge => {
		if (!isObject(value)) throw new Error(`Path ${index + 1} is invalid.`);
		const id = readId(value.id, `path ${index + 1}`);
		if (edgeIds.has(id)) throw new Error(`Path id ${id} is duplicated.`);
		edgeIds.add(id);
		const from = readId(value.from, `path ${id} source`);
		const to = readId(value.to, `path ${id} destination`);
		if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) {
			throw new Error(`Path ${id} does not connect two valid states.`);
		}
		return {
			id,
			from,
			to
		};
	});

	assertAcyclic(nodes, edges);
	const focusNodeIds = Array.isArray(input.focusNodeIds)
		? input.focusNodeIds.filter((id): id is string => typeof id === 'string' && nodeIds.has(id))
		: [];

	return {
		title: readText(input.title, 'title', 100),
		summary: readText(input.summary, 'summary', 300),
		nodes,
		edges,
		focusNodeIds
	};
}

export function layoutGraph(graph: DiagramGraph | undefined): DiagramLayout {
	if (!graph) return { nodes: [], edges: [], width: 1200, height: 720 };

	const incomingCount = new Map(graph.nodes.map((node) => [node.id, 0]));
	const outgoing = new Map<string, DiagramEdge[]>();
	const parents = new Map<string, string[]>();
	for (const edge of graph.edges) {
		incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
		outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
		parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
	}

	const depths = new Map<string, number>();
	const remainingIncoming = new Map(incomingCount);
	const queue = graph.nodes.filter((node) => remainingIncoming.get(node.id) === 0);
	queue.forEach((node) => depths.set(node.id, 0));

	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const node = queue[cursor];
		const depth = depths.get(node.id) ?? 0;
		for (const edge of outgoing.get(node.id) ?? []) {
			depths.set(edge.to, Math.max(depths.get(edge.to) ?? 0, depth + 1));
			const incomingLeft = (remainingIncoming.get(edge.to) ?? 0) - 1;
			remainingIncoming.set(edge.to, incomingLeft);
			if (incomingLeft === 0) {
				const target = graph.nodes.find((candidate) => candidate.id === edge.to);
				if (target) queue.push(target);
			}
		}
	}

	graph.nodes.forEach((node) => {
		if (!depths.has(node.id)) depths.set(node.id, 0);
	});

	const columns = new Map<number, DiagramNode[]>();
	for (const node of graph.nodes) {
		const depth = depths.get(node.id) ?? 0;
		columns.set(depth, [...(columns.get(depth) ?? []), node]);
	}

	const maxDepth = Math.max(0, ...depths.values());
	const largestColumn = Math.max(1, ...[...columns.values()].map((column) => column.length));
	const width = Math.max(1200, 120 + (maxDepth + 1) * 390);
	const height = Math.max(720, 120 + largestColumn * 138);
	const nodes: PositionedNode[] = [];
	const orderById = new Map<string, number>();

	for (let depth = 0; depth <= maxDepth; depth += 1) {
		const column = [...(columns.get(depth) ?? [])].sort((a, b) => {
			const parentDifference =
				parentOrder(a.id, parents, orderById) - parentOrder(b.id, parents, orderById);
			if (Math.abs(parentDifference) > 0.01) return parentDifference;
			return outlookOrder(a.outlook) - outlookOrder(b.outlook);
		});
		const occupiedHeight = Math.max(0, (column.length - 1) * 138 + NODE_HEIGHT);
		const startY = Math.max(64, (height - occupiedHeight) / 2);
		column.forEach((node, index) => {
			nodes.push({ ...node, x: 70 + depth * 390, y: startY + index * 138, depth });
			orderById.set(node.id, index);
		});
	}

	return { nodes, edges: graph.edges, width, height };
}

function assertAcyclic(nodes: DiagramNode[], edges: DiagramEdge[]): void {
	const incoming = new Map(nodes.map((node) => [node.id, 0]));
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
		outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
	}

	const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
	let visited = 0;
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const id = queue[cursor];
		visited += 1;
		for (const target of outgoing.get(id) ?? []) {
			const count = (incoming.get(target) ?? 0) - 1;
			incoming.set(target, count);
			if (count === 0) queue.push(target);
		}
	}
	if (visited !== nodes.length) throw new Error('Future paths cannot loop backward.');
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
		throw new Error(`${field} needs a short alphanumeric id.`);
	}
	return value;
}

function readText(value: unknown, field: string, maximum: number): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} cannot be empty.`);
	return value.trim().slice(0, maximum);
}

function outlookOrder(outlook: DiagramOutlook): number {
	if (outlook === 'positive') return 0;
	if (outlook === 'neutral') return 1;
	return 2;
}

function parentOrder(
	nodeId: string,
	parents: Map<string, string[]>,
	orderById: Map<string, number>
): number {
	const orders = (parents.get(nodeId) ?? [])
		.map((parentId) => orderById.get(parentId))
		.filter((order): order is number => order !== undefined);
	if (orders.length === 0) return 0;
	return orders.reduce((total, order) => total + order, 0) / orders.length;
}
