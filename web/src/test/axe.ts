import axe from "axe-core";
import { expect } from "vitest";

/**
 * Roda o axe no contêiner e falha com a lista de violações (SC-005).
 * `color-contrast` fica de fora: o jsdom não calcula layout nem cor. O
 * contraste dos tokens é verificado à parte, em `styles/contrast.test.ts`.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
	const results = await axe.run(container, {
		rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
	});
	const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
	expect(summary).toEqual([]);
}
