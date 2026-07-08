import axios from "axios";
import PixivApi from "../src/pixiv-api-client.js";
import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("axios");

const mockedAxios = vi.mocked(axios);

describe("PixivApi SDK test", () => {
  let pixivApi: PixivApi;

  beforeEach(() => {
    vi.clearAllMocks();

    mockedAxios.create.mockReturnValue(mockedAxios as any);

    pixivApi = new PixivApi();
  });

  test("should generate correct default headers with crypto hash", async () => {
    mockedAxios.mockResolvedValueOnce({
      data: { response: { status: "success" } },
    });

    await pixivApi.userState();

    expect(mockedAxios).toHaveBeenCalled();

    const sentOptions = mockedAxios.mock.lastCall![1] as any;
    expect(sentOptions.headers["App-OS"]).toBe("android");
    expect(sentOptions.headers["X-Client-Hash"]).toHaveLength(32);
  });

  test("tokenRequest should fetch and save auth token", async () => {
    const mockAuthResponse = {
      access_token: "fake_access_token_123",
      refresh_token: "fake_refresh_token_456",
      user: { id: "999", name: "Miku" },
    };

    mockedAxios.mockResolvedValueOnce({
      data: { response: mockAuthResponse },
    });

    const result = await pixivApi.tokenRequest("mock_code", "mock_verifier");

    expect(result.access_token).toBe("fake_access_token_123");
    expect(pixivApi.authInfo().access_token).toBe("fake_access_token_123");
  });

  test("request should contain Authorization header when authenticated", async () => {
    (pixivApi as any).auth = { access_token: "valid_token" };

    mockedAxios.mockResolvedValueOnce({ data: { illusts: [] } });

    await pixivApi.searchIllust("vocaloid");

    const sentOptions = mockedAxios.mock.lastCall![1] as any;
    expect(sentOptions.headers.Authorization).toBe("Bearer valid_token");
  });

  test("searchIllust should reject if word is empty", async () => {
    await expect(pixivApi.searchIllust("")).rejects.toThrow("word required");
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  test("callApi should retry when net error occurs", async () => {
    mockedAxios.mockRejectedValueOnce({ code: "ECONNRESET" });
    mockedAxios.mockResolvedValueOnce({ data: { response: "ok" } });

    const res = await pixivApi.userState();
    expect(res.response).toBe("ok");
    expect(mockedAxios).toHaveBeenCalledTimes(2);
  });
});
