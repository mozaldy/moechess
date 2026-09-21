import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ImportError,
  createChessComClient,
  monthUrl,
} from "@/lib/import/chesscom/client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Chess.com public client", () => {
  test("uses the fixed public API origin and rebuilds validated archive destinations", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/archives")) {
        return jsonResponse({
          archives: [
            "https://api.chess.com/pub/player/learner/games/2026/08",
            "https://api.chess.com/pub/player/learner/games/2026/09",
          ],
        });
      }
      return jsonResponse({ games: [{ uuid: "one" }] });
    }) as typeof fetch;
    const client = createChessComClient(fetcher);
    const signal = new AbortController().signal;

    await expect(client.archives("learner", signal)).resolves.toEqual(["2026/08", "2026/09"]);
    await expect(client.month("learner", "2026/09", signal)).resolves.toEqual([{ uuid: "one" }]);

    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.chess.com/pub/player/learner/games/archives",
      "https://api.chess.com/pub/player/learner/games/2026/09",
    ]);
    expect(requests[0].init).toMatchObject({ credentials: "omit", redirect: "error", cache: "default" });
  });

  test("rejects an archive URL that redirects import to another host", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      archives: ["https://evil.example/pub/player/learner/games/2026/09"],
    })) as typeof fetch;

    await expect(createChessComClient(fetcher).archives(
      "learner",
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("rejects an archive-list response redirected to another host", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      redirected: true,
      url: "https://evil.example/archives",
      headers: new Headers(),
      json: async () => ({
        archives: ["https://api.chess.com/pub/player/learner/games/2026/09"],
      }),
    } as Response)) as typeof fetch;

    await expect(createChessComClient(fetcher).archives(
      "learner",
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "invalid-response" });
  });

  test("rejects malformed month tokens before making a request", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const client = createChessComClient(fetcher);

    expect(() => monthUrl("learner", "2026/13")).toThrow(ImportError);
    await expect(client.month("learner", "../admin", new AbortController().signal))
      .rejects.toMatchObject({ code: "invalid-response" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("retries network and server failures twice using the bounded delays", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ games: [] })) as unknown as typeof fetch;
    const result = createChessComClient(fetcher).month(
      "learner",
      "2026/09",
      new AbortController().signal,
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("cancels an in-progress retry delay without another request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch;
    const result = createChessComClient(fetcher).month("learner", "2026/09", controller.signal);
    await Promise.resolve();

    controller.abort();

    await expect(result).rejects.toMatchObject({ code: "aborted" });
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("distinguishes request timeout from caller cancellation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const result = createChessComClient(fetcher).archives("learner", new AbortController().signal);
    const rejected = expect(result).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(30_000 + 2_000 + 30_000 + 5_000 + 30_000);

    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("keeps the request timeout active while the response body is being read", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      redirected: false,
      url: "",
      headers: new Headers(),
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    } as Response)) as typeof fetch;
    const result = createChessComClient(fetcher).archives("learner", controller.signal);
    let rejectedCode: string | undefined;
    void result.catch((error: ImportError) => { rejectedCode = error.code; });

    await vi.advanceTimersByTimeAsync(30_000 + 2_000 + 30_000 + 5_000 + 30_000);

    expect(rejectedCode).toBe("timeout");
    expect(fetcher).toHaveBeenCalledTimes(3);
    controller.abort();
  });

  test("stops on rate limiting and preserves a readable later retry date", async () => {
    vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
    const fetcher = vi.fn(async () => new Response("limited", {
      status: 429,
      headers: { "Retry-After": "Sun, 20 Sep 2026 00:02:00 GMT" },
    })) as typeof fetch;

    await expect(createChessComClient(fetcher).archives(
      "learner",
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: "rate-limit",
      retryAt: "2026-09-20T00:02:00.000Z",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("uses the manual cooldown when a rate-limit date is missing or unreadable", async () => {
    vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
    for (const retryAfter of [null, "invalid"]) {
      const headers = retryAfter === null ? undefined : { "Retry-After": retryAfter };
      const fetcher = vi.fn(async () => new Response("limited", { status: 429, headers })) as typeof fetch;
      const error = await createChessComClient(fetcher).archives(
        "learner",
        new AbortController().signal,
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        code: "rate-limit",
        retryAt: "2026-09-20T00:01:00.000Z",
      });
    }
  });

  test("clamps readable past rate-limit dates to the current time", async () => {
    vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
    for (const retryAfter of ["0", "Sat, 19 Sep 2026 23:59:00 GMT"]) {
      const fetcher = vi.fn(async () => new Response("limited", {
        status: 429,
        headers: { "Retry-After": retryAfter },
      })) as typeof fetch;
      const error = await createChessComClient(fetcher).archives(
        "learner",
        new AbortController().signal,
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        code: "rate-limit",
        retryAt: "2026-09-20T00:00:00.000Z",
      });
    }
  });

  test("maps missing users and malformed JSON shapes to typed terminal errors", async () => {
    const notFound = createChessComClient(vi.fn(async () => new Response("missing", { status: 404 })) as typeof fetch);
    await expect(notFound.archives("learner", new AbortController().signal))
      .rejects.toMatchObject({ code: "not-found" });

    const malformed = createChessComClient(vi.fn(async () => jsonResponse({ archives: "nope" })) as typeof fetch);
    await expect(malformed.archives("learner", new AbortController().signal))
      .rejects.toMatchObject({ code: "invalid-response" });
  });
});
