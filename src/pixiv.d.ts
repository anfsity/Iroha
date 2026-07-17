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

interface DownloadConfig {
  thread: number;
  timeout: number;
  path?: string;
  tmp?: string;
  autoRename?: boolean;
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


