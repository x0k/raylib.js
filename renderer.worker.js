import { makeRendererMessagesHandler } from './raylib_worker.js';

onmessage = makeRendererMessagesHandler()
