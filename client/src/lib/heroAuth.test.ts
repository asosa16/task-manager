import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("requests an email link with the app redirect and allows new accounts", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { sendMagicLink } = await import("./heroAuth");
  const result = await sendMagicLink("person@example.com", "https://tasks.example.com");
  expect(result.error).toBeNull();
  const [url, options] = fetchMock.mock.calls[0];
  expect(new URL(url).pathname).toBe("/auth/v1/otp");
  expect(new URL(url).searchParams.get("redirect_to")).toBe("https://tasks.example.com");
  expect(JSON.parse(options.body)).toMatchObject({ email: "person@example.com", create_user: true });
  expect(JSON.parse(options.body)).not.toHaveProperty("password");
});

it("returns email rate limits so the form can show the error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ msg: "Email rate limit exceeded", code: "over_email_send_rate_limit" }),
    { status: 429 },
  )));
  const { sendMagicLink } = await import("./heroAuth");
  const result = await sendMagicLink("person@example.com", "https://tasks.example.com");
  expect(result.error?.message).toBe("Email rate limit exceeded");
});
