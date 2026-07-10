interface PixivUgoiraMeta {
  ugoira_metadata: {
    frames: { delay: number }[];
  };
}

interface UserData {
  id: number | string;
  name: string;
  [key: string]: any;
}

interface PixivIllustResponse {
  illusts: any[];
  next_url: string | null;
  [key: string]: any;
}

interface PixivIllustJSON {
  id: number | string;
  title: string;
  type: "ugoira" | "illust" | "manga" | string;
  meta_single_page: {
    original_image_url?: string;
  };
  meta_pages: {
    image_urls: {
      original: string;
    };
  }[];
}

interface PixivClient {
  ugoiraMetaData(id: number | string): Promise<PixivUgoiraMeta>;
  userDetail(id: number | string): Promise<{ user: UserData }>;
  userIllusts(id: number | string): Promise<PixivIllustResponse>;
  userBookmarksIllust(
    id: number | string,
    params?: string | { restrict: string },
  ): Promise<PixivIllustResponse>;
  requestUrl(url: string): Promise<PixivIllustResponse>;
}


const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

var ugoiraMeta: boolean;
var p_debug: boolean;
