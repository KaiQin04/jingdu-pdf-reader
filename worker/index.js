import { createCloudWorker } from '../src/cloud-handler.mjs';
import html from '../dist/reader.html';
import csp from '../dist/csp.txt';
import documents from '../dist/documents.json';

// No filesystem, outbound fetch, storage binding, credential, or model client.
export default createCloudWorker({ html, csp, documents });
