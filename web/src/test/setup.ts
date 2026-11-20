import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testes com `@vitest-environment node` (build) não têm DOM.
if (typeof document !== "undefined") {
	afterEach(() => {
		cleanup();
		document.documentElement.removeAttribute("data-theme");
	});
}
