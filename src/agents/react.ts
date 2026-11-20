import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { GraphRecursionError } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createModel } from "./model.js";
import {
	DEFAULT_MAX_ITERATIONS,
	type ReasoningStrategy,
	type StrategyResult,
	type Trace,
	type TraceEvent,
} from "./strategy.js";

interface AiToolCall {
	name: string;
	args: unknown;
}

function textOf(message: BaseMessage): string {
	return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

/** Converte as mensagens do agente ReAct em um rastro tipado (FR-002/FR-003). */
export function toTrace(messages: BaseMessage[]): Trace {
	const events: TraceEvent[] = [];
	for (const message of messages) {
		const type = message.getType();
		if (type === "ai") {
			const toolCalls = ((message as unknown as { tool_calls?: AiToolCall[] }).tool_calls) ?? [];
			const text = textOf(message);
			if (text.trim().length > 0) {
				events.push(toolCalls.length > 0 ? { type: "thought", content: text } : { type: "answer", content: text });
			}
			for (const call of toolCalls) {
				events.push({ type: "action", tool: call.name, args: call.args });
			}
		} else if (type === "tool") {
			events.push({ type: "observation", content: textOf(message) });
		}
	}
	return events;
}

function lastAnswer(trace: Trace): string | undefined {
	for (let i = trace.length - 1; i >= 0; i -= 1) {
		const event = trace[i];
		if (event?.type === "answer") {
			return event.content;
		}
	}
	return undefined;
}

function countLlmCalls(messages: BaseMessage[]): number {
	return messages.filter((message) => message.getType() === "ai").length;
}

/** Estratégia ReAct (FR-010): agente pré-construído do LangGraph sobre as tools. */
export function createReactStrategy(tools: StructuredToolInterface[]): ReasoningStrategy {
	return {
		name: "react",
		async run(input): Promise<StrategyResult> {
			const started = Date.now();
			const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
			const agent = createReactAgent({ llm: () => createModel((model) => model.bindTools(tools)), tools });

			let lastMessages: BaseMessage[] = [];
			let hitLimit = false;

			try {
				const stream = await agent.stream(
					{ messages: [{ role: "user", content: input.question }] },
					{ recursionLimit: maxIterations, streamMode: "values" },
				);
				for await (const state of stream as AsyncIterable<{ messages: BaseMessage[] }>) {
					lastMessages = state.messages;
				}
			} catch (error) {
				if (error instanceof GraphRecursionError) {
					hitLimit = true;
				} else {
					throw error;
				}
			}

			const trace = toTrace(lastMessages);
			const answer =
				lastAnswer(trace) ??
				(hitLimit
					? "Limite de iterações atingido antes de uma resposta final."
					: "Nenhuma resposta foi produzida.");

			return {
				answer,
				trace,
				metrics: { llmCalls: countLlmCalls(lastMessages), latencyMs: Date.now() - started },
			};
		},
	};
}
