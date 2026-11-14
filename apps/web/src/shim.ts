import { Buffer } from 'buffer'

// Some wallet/NEAR dependencies read `process` (env flags, nextTick) as if running in Node.
// Provide a minimal stand-in before any of them is evaluated (this module must be imported first).
const scope = globalThis as unknown as { process?: unknown }
scope.process ??= { env: {}, browser: true, version: '', versions: {}, pid: 0, platform: 'browser', noDeprecation: true, argv: [], cwd: () => '/', on: () => undefined, emit: () => false, emitWarning: () => undefined, nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => callback(...args)) }

// Some wallet code paths (signing and sending transactions) use the Node global `Buffer`.
;(globalThis as unknown as { Buffer?: unknown }).Buffer ??= Buffer
