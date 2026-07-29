/**
 * Copyright (C) 2026 Anfsity
 */

interface PixivUgoiraMeta {
  ugoira_metadata: {
    frames: UgoiraFrame[];
  };
}

interface UgoiraFrame {
  file: string;
  delay: number;
}

interface UserData {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

interface PixivAuthInfo {
  access_token: string;
  refresh_token: string;
  user: UserData;
  [key: string]: unknown;
}

interface PixivTokenResponse {
  response: PixivAuthInfo;
  [key: string]: unknown;
}

interface PixivIllustResponse {
  illusts: PixivIllustJSON[];
  next_url: string | null;
  [key: string]: unknown;
}

interface PixivIllustDetailResponse {
  illust: PixivIllustJSON;
  [key: string]: unknown;
}

interface PixivUserPreview {
  user: UserData;
  illusts: PixivIllustJSON[];
  [key: string]: unknown;
}

interface PixivFollowingResponse {
  user_previews: PixivUserPreview[];
  next_url: string | null;
  [key: string]: unknown;
}

interface PixivIllustJSON {
  id: number | string;
  title: string;
  type: "ugoira" | "illust" | "manga" | string;
  x_restrict?: number;
  restrict?: number;
  caption?: string;
  tags?: Array<{ name: string; translated_name?: string | null }>;
  page_count?: number;
  visible?: boolean;
  user?: UserData;
  [key: string]: unknown;
  meta_single_page: {
    original_image_url?: string;
  };
  meta_pages: {
    image_urls: {
      original: string;
    };
  }[];
}
