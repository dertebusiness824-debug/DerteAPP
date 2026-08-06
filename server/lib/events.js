import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub used to push chat messages and dashboard updates to
 * connected clients over Server-Sent Events. Single-node by design; the client
 * also polls, so a missed event never loses data.
 */
class Hub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  publish(channel, payload) {
    this.emit(channel, payload);
    this.emit('*', { channel, payload });
  }

  subscribe(channel, listener) {
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }
}

export const hub = new Hub();

export const channels = {
  thread: (threadId) => `thread:${threadId}`,
  shop: (shopId) => `shop:${shopId}`,
  admin: () => 'admin',
};

/**
 * Turns an Express response into an SSE stream and forwards everything
 * published on `channelNames` to the client until it disconnects.
 */
export function openStream(req, res, channelNames, { onOpen } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribers = channelNames.map((channel) =>
    hub.subscribe(channel, (payload) => send(payload?.type ?? 'message', payload)),
  );

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  heartbeat.unref?.();

  const close = () => {
    clearInterval(heartbeat);
    for (const off of unsubscribers) off();
    res.end();
  };
  req.on('close', close);
  req.on('aborted', close);

  send('ready', { type: 'ready', channels: channelNames, at: new Date().toISOString() });
  onOpen?.(send);
  return { send, close };
}
