/**
 * Pure helpers of the server LLM client — no network. The grounding gate
 * (spanGrounded/snapToSource) moved here from the fabric validator, so these
 * assertions are what keeps ungrounded spans out of cs_tension_candidates.
 */
import { describe, it, expect, vi } from "vitest";
import {
  spanGrounded,
  snapToSource,
  parseModelJson,
  fetchWithLemonadeModelRecovery,
} from "../app/lib/llm/ollama";

describe("spanGrounded", () => {
  const text =
    "Chemical fertilizers feed the plant directly, while compost feeds the soil life that in turn feeds the plant.";

  it("accepts verbatim spans, tolerating whitespace and curly quotes", () => {
    expect(spanGrounded("compost feeds the soil life", text)).toBe(true);
    expect(spanGrounded("compost  feeds   the soil life", text)).toBe(true);
    expect(spanGrounded("Compost Feeds The Soil Life", text)).toBe(true);
  });

  it("rejects paraphrases and too-short spans", () => {
    expect(spanGrounded("compost nourishes the soil biota", text)).toBe(false);
    expect(spanGrounded("plant", text)).toBe(false); // < 8 chars
    expect(spanGrounded("", text)).toBe(false);
  });
});

describe("snapToSource", () => {
  const text =
    "The general crossed the river at dawn. His army numbered forty thousand men, though the record books disagree. " +
    "Later historians would question every count made that morning.";

  it("snaps a light paraphrase back to the verbatim sentence", () => {
    const snapped = snapToSource(
      "His army numbered forty thousand men though records disagree",
      text,
    );
    expect(snapped.length).toBeGreaterThan(0);
    expect(text).toContain(snapped);
  });

  it("returns empty when nothing meaningfully overlaps", () => {
    expect(snapToSource("the stock market collapsed in nineteen twenty nine", text)).toBe("");
  });
});

describe("parseModelJson", () => {
  it("parses plain JSON, fenced JSON, and JSON with surrounding prose", () => {
    expect(parseModelJson<{ a: number }>('{"a":1}').a).toBe(1);
    expect(parseModelJson<{ a: number }>('```json\n{"a":2}\n```').a).toBe(2);
    expect(parseModelJson<{ a: number }>('Sure! Here you go: {"a":3} Hope that helps.').a).toBe(3);
  });

  it("strips reasoning-model <think> blocks before parsing", () => {
    expect(
      parseModelJson<{ a: number }>('<think>The user wants {json}. Let me comply.</think>{"a":4}')
        .a,
    ).toBe(4);
    expect(parseModelJson<{ a: number }>('<THINK>\nhmm\n</THINK>\n```json\n{"a":5}\n```').a).toBe(
      5,
    );
  });

  it("throws a clear error on garbage", () => {
    expect(() => parseModelJson("<!DOCTYPE html><html>starting up</html>")).toThrow(
      /parseable JSON/,
    );
  });
});

describe("Lemonade model recovery", () => {
  it("loads an evicted model and retries the original request once", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "No model loaded: Qwen3-8B-GGUF" } }), {
          status: 500,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "success" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    const result = await fetchWithLemonadeModelRecovery(
      "http://lemonade.test/v1/chat/completions",
      { method: "POST", body: "{}" },
      "Qwen3-8B-GGUF",
      fetchMock,
      "http://lemonade.test",
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://lemonade.test/api/v1/load");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ model_name: "Qwen3-8B-GGUF" }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://lemonade.test/v1/chat/completions");
  });

  it("does not retry unrelated backend failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("out of memory", { status: 500 }));
    const result = await fetchWithLemonadeModelRecovery(
      "http://lemonade.test/v1/chat/completions",
      { method: "POST", body: "{}" },
      "Qwen3-8B-GGUF",
      fetchMock,
      "http://lemonade.test",
    );
    expect(result.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
