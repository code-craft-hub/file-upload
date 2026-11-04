/**
 * Wraps an async iterable in a pull-based Web `ReadableStream`.
 *
 * `highWaterMark: 0` means the source is not touched until a consumer reads,
 * which gives natural backpressure (one chunk in flight) and makes unread
 * streams — e.g. for `HEAD` requests — free.
 */
export function toReadableStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    },
    { highWaterMark: 0 },
  );
}
