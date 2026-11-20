import { createMockConversationStore } from "./mock-conversation-store.js";
import { runConversationStoreContractTests } from "./conversation-store.contract-tests.js";

runConversationStoreContractTests("mock", () => createMockConversationStore());
