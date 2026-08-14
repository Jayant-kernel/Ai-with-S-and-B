import { describe, expect, it, vi } from "vitest";

import { createRealtimeClientSecret } from "../../lib/realtime/client-secret";

describe("Realtime client secret", () => {
  it("sends the standard key only to OpenAI and returns only the temporary credential", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ value: "temporary-client-credential" }),
    );

    const result = await createRealtimeClientSecret({
      apiKey: "private-standard-key",
      model: "gpt-realtime-2.1-mini",
      voice: "marin",
      reasoningEffort: "low",
      safetyIdentifier: "pseudonymous-id",
      fetchImplementation: fetchMock as typeof fetch,
    });

    expect(result).toBe("temporary-client-credential");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0];
    expect(options).toBeDefined();
    if (!options) throw new Error("Expected fetch options");
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer private-standard-key",
      "OpenAI-Safety-Identifier": "pseudonymous-id",
    });

    const body = JSON.parse(String(options.body));
    expect(body.session.model).toBe("gpt-realtime-2.1-mini");
    expect(body.session.truncation).toEqual({
      type: "retention_ratio",
      retention_ratio: 0.8,
      token_limits: { post_instructions: 8000 },
    });
  });
});
