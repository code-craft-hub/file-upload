import { describeFileStorageContract } from "../../testing/file-storage-contract";
import { InMemoryFileStorage } from "./in-memory-file-storage";

describeFileStorageContract("InMemoryFileStorage", async () => ({ storage: new InMemoryFileStorage() }));
