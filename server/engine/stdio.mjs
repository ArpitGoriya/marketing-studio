// How the extension's replies and log lines reach Claude Desktop without ever freezing it. On Windows, writing to
// the stdout/stderr pipe blocks the whole process until the other side reads (measured: a 20 MB write held the
// process for exactly as long as the reader paused). When Claude Desktop is busy or the laptop is short of memory,
// that froze everything: wait, status and reset couldn't answer, and recordings stopped. So the writing happens in
// a small worker thread instead: it may wait on the pipe, but the extension itself keeps running.
import { Writable } from 'node:stream';
import { Worker } from 'node:worker_threads';

// the writer: one message at a time, in order, straight to the file descriptor (1 = stdout, 2 = stderr)
const WRITER = `
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const nap = new Int32Array(new SharedArrayBuffer(4));
parentPort.on('message', ({ fd, buf, id }) => {
  const b = Buffer.from(buf);
  let at = 0;
  while (at < b.length) {
    try {
      at += fs.writeSync(fd, b, at);
    } catch (e) {
      if (e.code !== 'EAGAIN') break; // the pipe is gone: nothing more to do
      Atomics.wait(nap, 0, 0, 5); // a non-blocking pipe is full: try again shortly
    }
  }
  if (id) parentPort.postMessage(id);
});
`;

let worker = null;
let next = 0;
const done = new Map();

function writer() {
  if (worker) return worker;
  worker = new Worker(WRITER, { eval: true });
  worker.on('message', (id) => {
    done.get(id)?.();
    done.delete(id);
  });
  worker.on('error', () => (worker = null));
  worker.unref();
  return worker;
}

// stdout for the MCP transport: a write finishes when the worker has written it (so order and backpressure hold),
// but the main thread only awaits it, it never blocks on it
export const stdoutStream = () =>
  new Writable({
    write(chunk, _enc, cb) {
      const id = ++next;
      done.set(id, cb);
      writer().postMessage({ fd: 1, buf: chunk, id });
    },
  });

// log lines (console.error) go the same way, without waiting
export function quietStderr() {
  const send = (...a) => writer().postMessage({ fd: 2, buf: Buffer.from(`${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`) });
  console.error = send;
  console.warn = send;
}
