import { env } from '$env/dynamic/private';
import { parseGraph, type DiagramGraph } from '$lib/diagram';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_MODEL = 'gpt-5.6-luna';
const DEFAULT_REASONING_EFFORT = 'high';
const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const graphSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['title', 'summary', 'nodes', 'edges', 'focusNodeIds'],
	properties: {
		title: { type: 'string', minLength: 1, maxLength: 100 },
		summary: { type: 'string', minLength: 1, maxLength: 300 },
		nodes: {
			type: 'array',
			minItems: 5,
			maxItems: 9,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'text', 'kind', 'outlook'],
				properties: {
					id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
					text: { type: 'string', minLength: 1, maxLength: 180 },
					kind: { type: 'string', enum: ['origin', 'state', 'horizon'] },
					outlook: { type: 'string', enum: ['positive', 'negative', 'neutral'] }
				}
			}
		},
		edges: {
			type: 'array',
			minItems: 1,
			maxItems: 80,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id', 'from', 'to'],
				properties: {
					id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
					from: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
					to: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' }
				}
			}
		},
		focusNodeIds: {
			type: 'array',
			maxItems: 30,
			items: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' }
		}
	}
} as const;

const instructions = `Create a compact graph of the major moments and forces that make the user's prompt meaningful.

Treat every prompt as one moment inside a larger story. Before making nodes, infer the central character or subject, their most plausible role, what they want, what shaped the current tension, who else is affected, and what larger direction is at stake. Use that frame silently. Broaden the meaning of the graph, not the number of minor scenarios.

Origin fidelity overrides broader story framing. The origin must closely resemble the user's original prompt in meaning, scope, wording, and sentence structure. Preserve the named subject, action or question, key object, timeframe, uncertainty, and unusual terms. You may fix grammar, change first person to second person, and lightly compress the sentence for readability. Do not add an actor, motive, identity, cause, interpretation, or adjacent scenario that the user did not state. Put every inferred role and wider story connection in later nodes. Examples: "Release open-source AGI" becomes "You release open-source AGI." "Should I launch my app this weekend?" becomes "You consider launching your app this weekend." "Is Shanks a fraud?" becomes "The question is whether Shanks is a fraud."

When the prompt concerns the user, treat them as the central character in an ongoing life story. After the faithful origin, infer one concrete, plausible identity and pursuit from the prompt, then use it consistently without presenting the inference as certain fact. For example, frame someone launching an app as an indie developer trying to turn an idea into a real product and begin an independent adventure. Show how launching changes that larger pursuit, their relationship with users, their skill, and their direction. Do not stop at "people like it" or "people do not like it."

When the prompt concerns a fictional character, ground the nodes after the faithful origin in established canon and the work's general story. Connect the question to the character's place in the main plot, defining pursuit or dream, relationships, conflicts, effect on other characters, and unresolved direction. Do not isolate one incident from the arc it belongs to or invent events outside the canon.

When the prompt concerns a real person, use known aims, public choices, relationships, and effects on other people. Connect the immediate question to the person's larger life or historical arc. Do not invent private motives or assign an objective destiny. Treat purpose as the role they occupy, the pursuit they demonstrate, and what changes because of them. For a group, project, or system, infer the same larger function, pressures, affected people, and direction.

A question may require established events from before the current moment. Include a past event only when it explains the central tension, a later choice, or the subject's place in the larger story. Keep causal order clear. Use unresolved directions where the story is unfinished instead of claiming certainty.

Infer the subject and direction without asking questions. Start with the situation the user described. For an ordinary forward-looking prompt, give the origin exactly two immediate outcomes: one favorable and one adverse. Do not add a third neutral outcome unless the user explicitly asks for more alternatives. Outlook is local to each state. A negative state may lead to recovery, acceptance, learning, or another positive state. A positive state may lead to a real setback. Never treat positive and negative as permanent lanes.

Use this major-moment filter. Let R(s) be the materially different futures reachable after state s. Keep a transition from s to t only when distance(R(s), R(t)) is large enough to change the available choices, relationship, commitment, health, resources, identity, pursuit, role in the larger story, effect on others, or core outcome. Otherwise skip t and connect to the next major moment.

Use 5 to 9 states. There is no minimum path length. Stop a path after one outcome when later events are only adjustment, repetition, fading contact, or the passage of time. Add another node only when it changes what can still happen. Do not make an adverse path progressively worse after its main cost has already occurred. Check whether a meaningful recovery state follows instead.

Example: after "I tell her I have feelings," "She does not feel the same" is a major adverse outcome. Do not pad it with several rejection states. If moving on becomes the next meaningful change, connect the rejection directly to "You accept her answer and move on."

Each node contains one self-contained sentence that says what happens. It must make sense without an edge label or hidden explanation. Connections carry no prose. Keep the graph acyclic, connected, and readable from left to right. The origin is neutral. Use neutral later only for a shared hinge or reconvergence. Assign outlook to each state on its own, regardless of its parent.

Do not recommend a path, moralize, invent probabilities, or claim certainty.

Use the uploaded unslop skill as an invisible editing step before returning the graph. Apply it to the title, summary, and every node sentence. Never mention unslop, skills, tools, instructions, schemas, graph production, or a "final graph" anywhere in the returned content. The graph must discuss only the user's subject. Keep each node between 6 and 18 words and do not write a heading followed by an explanation.

For a follow-up, use the current graph as context. Preserve unchanged ids and make the smallest coherent revision. Add a "what if" as a focused path rather than replacing the existing graph. Apply the major-moment filter to existing nodes too, and remove filler states that no longer earn a place. Return the full graph. focusNodeIds contains every added or changed node. On a new graph it contains every node id.`;

export const POST: RequestHandler = async ({ request, fetch }) => {
	if (!env.OPENAI_KEY) {
		return json({ error: 'Add OPENAI_KEY to .env, then restart the server.' }, { status: 503 });
	}
	if (!env.OPENAI_UNSLOP_SKILL_ID) {
		return json(
			{ error: 'Add OPENAI_UNSLOP_SKILL_ID to .env, then restart the server.' },
			{ status: 503 }
		);
	}

	const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
	const configuredReasoningEffort =
		env.OPENAI_REASONING_EFFORT?.trim() || DEFAULT_REASONING_EFFORT;
	if (!isReasoningEffort(configuredReasoningEffort)) {
		return json(
			{
				error: `OPENAI_REASONING_EFFORT must be one of: ${REASONING_EFFORTS.join(', ')}.`
			},
			{ status: 503 }
		);
	}
	const reasoningEffort = configuredReasoningEffort;

	let body: { prompt?: unknown; graph?: unknown; history?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request must contain JSON.' }, { status: 400 });
	}

	if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
		return json({ error: 'Enter a prompt.' }, { status: 400 });
	}
	if (body.prompt.length > 4000) {
		return json({ error: 'Keep the prompt under 4,000 characters.' }, { status: 400 });
	}

	let currentGraph: DiagramGraph | undefined;
	if (body.graph !== undefined && body.graph !== null) {
		try {
			currentGraph = parseGraph(body.graph);
		} catch (error) {
			return json(
				{ error: error instanceof Error ? error.message : 'The current diagram is invalid.' },
				{ status: 400 }
			);
		}
	}

	const history = Array.isArray(body.history)
		? body.history.filter((item): item is string => typeof item === 'string').slice(-12)
		: [];
	const context = currentGraph
		? `CURRENT GRAPH\n${JSON.stringify(currentGraph)}\n\nRECENT PROMPTS\n${history.join('\n')}\n\nNEW PROMPT\n${body.prompt.trim()}`
		: `NEW PROMPT\n${body.prompt.trim()}`;

	let response: Response;
	try {
		response = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.OPENAI_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				instructions,
				input: context,
				reasoning: { effort: reasoningEffort },
				tools: [
					{
						type: 'shell',
						environment: {
							type: 'container_auto',
							skills: [
								{
									type: 'skill_reference',
									skill_id: env.OPENAI_UNSLOP_SKILL_ID,
									version: '1'
								}
							]
						}
					}
				],
				text: {
					verbosity: 'low',
					format: {
						type: 'json_schema',
						name: 'possibility_diagram',
						strict: true,
						schema: graphSchema
					}
				},
				max_output_tokens: 7000,
				store: false
			})
		});
	} catch {
		return json({ error: 'OpenAI could not be reached.' }, { status: 502 });
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return json({ error: 'OpenAI returned an unreadable response.' }, { status: 502 });
	}

	if (!response.ok) return json({ error: providerError(payload) }, { status: response.status });

	try {
		const content = messageContent(payload)
			.replace(/^```(?:json)?\s*/i, '')
			.replace(/\s*```$/, '');
		return json({
			graph: parseGraph(JSON.parse(content)),
			model,
			reasoningEffort
		});
	} catch (error) {
		return json(
			{
				error:
					error instanceof Error
						? `The model returned an invalid diagram: ${error.message}`
						: 'The model returned an invalid diagram.'
			},
			{ status: 502 }
		);
	}
};

function messageContent(payload: unknown): string {
	if (!isObject(payload)) throw new Error('No result returned.');
	if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
	if (!Array.isArray(payload.output)) throw new Error('No result returned.');

	for (const item of payload.output) {
		if (!isObject(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
		const text = item.content
			.filter(
				(part) => isObject(part) && part.type === 'output_text' && typeof part.text === 'string'
			)
			.map((part) => String(part.text))
			.join('');
		if (text) return text;
	}
	throw new Error('No text returned.');
}

function providerError(payload: unknown): string {
	if (isObject(payload) && isObject(payload.error) && typeof payload.error.message === 'string') {
		return payload.error.message;
	}
	return 'OpenAI rejected the request.';
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReasoningEffort(value: string): value is ReasoningEffort {
	return REASONING_EFFORTS.some((effort) => effort === value);
}
