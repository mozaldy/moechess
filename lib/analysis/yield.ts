/**
 * Lets input, rendering and engine worker messages run between chunks of analysis.
 * Browsers clamp chained zero-delay timers to at least 4 ms, which the certificate
 * search would pay thousands of times per game; a message task is not clamped and
 * queues behind the worker messages already waiting.
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== "function") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
