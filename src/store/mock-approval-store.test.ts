import { runApprovalStoreContractTests } from "./approval-store.contract-tests.js";
import { createMockApprovalStore } from "./mock-approval-store.js";

runApprovalStoreContractTests("mock", () => createMockApprovalStore());
