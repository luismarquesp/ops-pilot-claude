import { createMockOpsStore } from "./mock-ops-store.js";
import { runOpsStoreContractTests } from "./ops-store.contract-tests.js";

runOpsStoreContractTests("mock", () => createMockOpsStore());
