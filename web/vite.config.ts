import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolveBuildConfig } from "./src/build-config.js";

/**
 * FR-006 (specs/019): o GitHub Pages serve `404.html` para qualquer caminho
 * desconhecido. Como a war room não tem rotas, ele é cópia do `index.html` —
 * recarregar ou abrir um caminho qualquer mostra a war room (status HTTP 404).
 */
function spaFallback(): Plugin {
	return {
		name: "opspilot-spa-fallback",
		apply: "build",
		enforce: "post",
		generateBundle(_options, bundle) {
			const index = bundle["index.html"];
			if (!index || index.type !== "asset") {
				throw new Error("spaFallback: index.html ausente do bundle");
			}
			this.emitFile({ type: "asset", fileName: "404.html", source: index.source });
		},
	};
}

/**
 * War room (specs/018). O caminho de publicação vem de `OPSPILOT_WEB_BASE`
 * (specs/019): sem ela, `/opspilot/` (FR-017); no GitHub Pages, o workflow passa
 * o caminho real do site. Configuração inválida derruba o build citando só o
 * nome da variável.
 */
export default defineConfig(({ mode }) => {
	const result = resolveBuildConfig({ ...loadEnv(mode, process.cwd(), ""), ...process.env });
	if (!result.ok) {
		throw new Error(`Configuração inválida: ${result.invalid.join(", ")}`);
	}

	return {
		base: result.config.base,
		plugins: [react(), spaFallback()],
		preview: { port: 4173 },
		test: {
			environment: "jsdom",
			setupFiles: ["src/test/setup.ts"],
			css: true,
			restoreMocks: true,
			// axe sobre telas inteiras passa de 5s quando a suíte roda em paralelo.
			testTimeout: 15_000,
		},
	};
});
